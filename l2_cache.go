package main

import (
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/kallsyms/go-nexrad/archive2"
	"github.com/sirupsen/logrus"
)

type Archive2Metadata struct {
	LDMOffsets []int
	// For each elevation, the list of chunk offsets which hold any data for that elevation
	ElevationChunks [][]int
}

type Archive2ChunkCacheManager struct {
	mtx  sync.RWMutex
	meta map[string]Archive2Metadata
}

var ChunkCache Archive2ChunkCacheManager

func init() {
	ChunkCache = Archive2ChunkCacheManager{
		meta: make(map[string]Archive2Metadata),
	}
}

func urlForFile(fn string) (string, error) {
	// fn is like KOKX20210902_000428_V06
	site := fn[:4]
	date, err := time.Parse("20060102_150405", fn[4:19])
	if err != nil {
		return "", err
	}
	return "https://unidata-nexrad-level2.s3.amazonaws.com/" + date.Format("2006/01/02/") + site + "/" + fn, nil
}

func loadArchive2(fn string) (*archive2.Archive2, error) {
	url, err := urlForFile(fn)
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Bad status code fetching file: %d", resp.StatusCode)
	}

	return archive2.Extract(resp.Body)
}

func (cm *Archive2ChunkCacheManager) GetMeta(filename string) (Archive2Metadata, *archive2.Archive2, error) {
	cm.mtx.RLock()
	if meta, ok := cm.meta[filename]; ok {
		cm.mtx.RUnlock()
		return meta, nil, nil
	}
	cm.mtx.RUnlock()

	logrus.Debugf("%q not in cache", filename)
	ar2, err := loadArchive2(filename)
	if err != nil {
		return Archive2Metadata{}, nil, err
	}

	meta := Archive2Metadata{
		LDMOffsets:      ar2.LDMOffsets,
		ElevationChunks: make([][]int, len(ar2.ElevationScans)),
	}

	// I hate go. All of this nonsense to literally just do a set-like thing
	// python:
	// chunkSets[elv - 1].add(offset)
	// ...
	// meta.ElevationChunks = [sorted(list(chunkSets[elv])) for elv in range(len(ElevationScans))]

	chunkSets := make([]map[int]struct{}, len(ar2.ElevationScans))
	for i := range chunkSets {
		chunkSets[i] = make(map[int]struct{})
	}
	for i, record := range ar2.LDMRecords {
		offset := ar2.LDMOffsets[i]
		for _, m31 := range record.M31s {
			chunkSets[m31.Header.ElevationNumber-1][offset] = struct{}{}
		}
	}

	for elv, offsetMap := range chunkSets {
		offsets := make([]int, 0, len(offsetMap))
		for offset := range offsetMap {
			offsets = append(offsets, offset)
		}
		sort.Ints(offsets)
		meta.ElevationChunks[elv] = offsets
	}

	cm.mtx.Lock()
	cm.meta[filename] = meta
	cm.mtx.Unlock()

	return meta, ar2, nil
}

func (cm *Archive2ChunkCacheManager) GetFile(filename string) (*archive2.Archive2, error) {
	return loadArchive2(filename)
}

func (cm *Archive2ChunkCacheManager) GetFileWithElevation(filename string, elv int) (*archive2.Archive2, error) {
	meta, ar2, err := cm.GetMeta(filename)
	if err != nil {
		return nil, err
	}
	if ar2 != nil {
		return ar2, nil
	}

	url, err := urlForFile(filename)
	if err != nil {
		return nil, err
	}

	// Load the main header and the first LDM message (should be a Message2)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Add("Range", fmt.Sprintf("bytes=0-%d", meta.LDMOffsets[1]-1))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	ar2, err = archive2.Extract(resp.Body)
	if err != nil {
		return nil, err
	}

	mtx := sync.Mutex{}
	wg := sync.WaitGroup{}

	// Load all of the other records we need for this elevation
	for _, offset := range meta.ElevationChunks[elv-1] {
		wg.Add(1)
		go func(offset int) {
			defer wg.Done()

			req, _ := http.NewRequest("GET", url, nil)
			// everything is streamed so it should be fine that we request to EOF here,
			// despite only needing probably a few hundred KB
			req.Header.Add("Range", fmt.Sprintf("bytes=%d-", offset))
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return
			}

			record, err := ar2.LoadLDMRecord(resp.Body)
			resp.Body.Close()
			if err != nil {
				return
			}

			mtx.Lock()
			ar2.AddFromLDMRecord(record)
			mtx.Unlock()
		}(offset)
	}
	wg.Wait()

	return ar2, nil
}
