package main

import (
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/kallsyms/go-nexrad/archive2"
	"github.com/kallsyms/radserv/render"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
)

func loadArchive2Realtime(site string, volume int) (*archive2.Archive2, error) {
	sess, _ := session.NewSession(&aws.Config{
		Credentials: credentials.AnonymousCredentials,
		Region:      aws.String("us-east-1"),
	})
	svc := s3.New(sess)
	bucket := aws.String("unidata-nexrad-level2-chunks")

	// Paginate to collect all chunk objects for this volume
	var token *string
	var objects []*s3.Object
	for {
		resp, err := svc.ListObjectsV2(&s3.ListObjectsV2Input{
			Bucket:            bucket,
			Prefix:            aws.String(fmt.Sprintf("%s/%d/", site, volume)),
			ContinuationToken: token,
		})
		if err != nil {
			return nil, err
		}
		objects = append(objects, resp.Contents...)
		if resp.IsTruncated == nil || !*resp.IsTruncated {
			break
		}
		token = resp.NextContinuationToken
	}

	if len(objects) == 0 {
		return nil, errors.New("No such volume number")
	}

	headerFile, err := svc.GetObject(&s3.GetObjectInput{
		Bucket: bucket,
		Key:    objects[0].Key,
	})
	if err != nil {
		return nil, err
	}

	ar2, err := archive2.Extract(headerFile.Body)
	headerFile.Body.Close()
	if err != nil {
		return nil, err
	}

	mtx := sync.Mutex{}
	wg := sync.WaitGroup{}
	for _, chunkObjectInfo := range objects[1:] {
		wg.Add(1)
		go func(chunkObjectInfo *s3.Object) {
			defer wg.Done()

			chunk, err := svc.GetObject(&s3.GetObjectInput{
				Bucket: bucket,
				Key:    chunkObjectInfo.Key,
			})
			if err != nil {
				return
			}

			record, err := ar2.LoadLDMRecord(chunk.Body)
			chunk.Body.Close()
			if err != nil {
				return
			}
			mtx.Lock()
			ar2.AddFromLDMRecord(record)
			mtx.Unlock()
		}(chunkObjectInfo)
	}
	wg.Wait()

	return ar2, nil
}

func realtimeMetaHandler(c *gin.Context) {
	site := c.Param("site")
	volume, err := strconv.Atoi(c.Param("volume"))
	if err != nil {
		c.AbortWithError(http.StatusBadRequest, errors.New("Invalid elv"))
		return
	}

	ar2, err := loadArchive2Realtime(site, volume)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	headers := make([]*archive2.Message31Header, len(ar2.ElevationScans))
	for elv, m31s := range ar2.ElevationScans {
		headers[elv-1] = &m31s[0].Header
	}

	c.JSON(200, headers)
}

func realtimeRenderHandler(c *gin.Context) {
	site := c.Param("site")
	volume, err := strconv.Atoi(c.Param("volume"))
	if err != nil {
		c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	elv, err := strconv.Atoi(c.Param("elv"))
	if err != nil {
		c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	product := c.Param("product")

	ar2, err := loadArchive2Realtime(site, volume)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	r, err := render.RadialSetFromLevel2(ar2.ElevationScans[elv], product)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	lut := render.DefaultLUT(product)

	pngFile := render.RenderAndReproject(r, lut, 6000, 2600)
	png, _ := ioutil.ReadAll(pngFile)
	pngFile.Close()

	c.Data(http.StatusOK, "image/png", png)
}
