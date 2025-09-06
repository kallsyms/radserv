package main

import (
	"errors"
	"io/ioutil"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/kallsyms/radserv/render"
)

func l2ListSitesHandler(c *gin.Context) {
	sess, _ := session.NewSession(&aws.Config{
		Credentials: credentials.AnonymousCredentials,
		Region:      aws.String("us-east-1"),
	})
	svc := s3.New(sess)
	bucket := aws.String("unidata-nexrad-level2")

	// check yesterday to get a list of all radars
	t := time.Now().UTC().AddDate(0, 0, -1)
	sites := make([]string, 0, 512)
	var token *string
	for {
		resp, err := svc.ListObjectsV2(&s3.ListObjectsV2Input{
			Bucket:            bucket,
			Prefix:            aws.String(t.Format("2006/01/02/")),
			Delimiter:         aws.String("/"),
			ContinuationToken: token,
		})
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		for _, d := range resp.CommonPrefixes {
			sites = append(sites, filepath.Base(*d.Prefix))
		}
		if resp.IsTruncated == nil || !*resp.IsTruncated {
			break
		}
		token = resp.NextContinuationToken
	}

	c.JSON(200, sites)
}

func l2ListFilesHandler(c *gin.Context) {
	site := c.Param("site")
	dateParam := c.Param("date") // may be empty if route is /l2/:site

	sess, _ := session.NewSession(&aws.Config{
		Credentials: credentials.AnonymousCredentials,
		Region:      aws.String("us-east-1"),
	})
	svc := s3.New(sess)
	bucket := aws.String("unidata-nexrad-level2")

	// Helper to list all objects for a given day prefix
	listDay := func(day time.Time) ([]*s3.Object, error) {
		prefix := day.Format("2006/01/02/") + site
		var token *string
		objs := make([]*s3.Object, 0, 1024)
		for {
			resp, err := svc.ListObjectsV2(&s3.ListObjectsV2Input{
				Bucket:            bucket,
				Prefix:            aws.String(prefix),
				ContinuationToken: token,
			})
			if err != nil {
				return nil, err
			}
			objs = append(objs, resp.Contents...)
			if resp.IsTruncated == nil || !*resp.IsTruncated {
				break
			}
			token = resp.NextContinuationToken
		}
		return objs, nil
	}

	// If a date is provided
	if dateParam != "" {
		if strings.EqualFold(dateParam, "latest") {
			// Gather latest up to 100 scans, going back across days
			now := time.Now().UTC()
			objects := make([]*s3.Object, 0, 200)
			// Limit how far back to search to avoid excessive listing; usually a day or two suffices
			for i := 0; i < 7 && len(objects) < 100; i++ {
				day := now.AddDate(0, 0, -i)
				objs, err := listDay(day)
				if err != nil {
					c.AbortWithError(http.StatusInternalServerError, err)
					return
				}
				objects = append(objects, objs...)
			}
			// Sort by LastModified asc
			sort.Slice(objects, func(i, j int) bool {
				ti := time.Time{}
				tj := time.Time{}
				if objects[i].LastModified != nil {
					ti = *objects[i].LastModified
				}
				if objects[j].LastModified != nil {
					tj = *objects[j].LastModified
				}
				return ti.Before(tj)
			})
			if len(objects) > 100 {
				objects = objects[len(objects)-100:]
			}
			files := make([]string, 0, len(objects))
			for _, o := range objects {
				if o.Key == nil {
					continue
				}
				base := filepath.Base(*o.Key)
				if isMDMFile(base) {
					continue
				}
				files = append(files, base)
			}
			// Return newest-first for convenience
			c.JSON(200, files)
			return
		}
		// Parse YYYYMMDD
		t, err := time.Parse("20060102", dateParam)
		if err != nil {
			c.AbortWithError(http.StatusBadRequest, errors.New("Invalid date format, expected YYYYMMDD or 'latest'"))
			return
		}
		objs, err := listDay(t)
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		files := make([]string, 0, len(objs))
		for _, d := range objs {
			if d.Key == nil {
				continue
			}
			base := filepath.Base(*d.Key)
			if isMDMFile(base) {
				continue
			}
			files = append(files, base)
		}
		c.JSON(200, files)
		return
	}

	// Default behavior (no date specified): current UTC day
	now := time.Now().UTC()
	objs, err := listDay(now)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	files := make([]string, 0, len(objs))
	for _, d := range objs {
		if d.Key == nil {
			continue
		}
		base := filepath.Base(*d.Key)
		if isMDMFile(base) {
			continue
		}
		files = append(files, base)
	}
	c.JSON(200, files)
}

func l2FileMetaHandler(c *gin.Context) {
	fn := c.Param("fn")

	meta, _, err := ChunkCache.GetMeta(fn)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	c.JSON(200, meta)
}

func l2FileIsosurfaceHandler(c *gin.Context) {
	fn := c.Param("fn")
	threshold, err := strconv.ParseFloat(c.Param("threshold"), 64)
	if err != nil {
		c.AbortWithError(http.StatusBadRequest, errors.New("Invalid threshold"))
		return
	}

	product := strings.ToLower(c.Param("product"))

	ar2, err := ChunkCache.GetFile(fn)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	elevations := render.ElevationSet{}
	for _, scan := range ar2.ElevationScans {
		elv, err := render.RadialSetFromLevel2(scan, product)
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		elevations = append(elevations, elv)
	}

	tris := render.CreateIsosurface(elevations, threshold)

	c.Status(http.StatusOK)
	c.Header("Content-Type", "text/plain")
	render.WriteOBJ(tris, c.Writer)
}

func l2FileRadialHandler(c *gin.Context) {
	fn := c.Param("fn")
	elv, err := strconv.Atoi(c.Param("elv"))
	if err != nil {
		c.AbortWithError(http.StatusBadRequest, errors.New("Invalid elv"))
		return
	}

	product := strings.ToLower(c.Param("product"))

	ar2, err := ChunkCache.GetFileWithElevation(fn, elv)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	r, err := render.RadialSetFromLevel2(ar2.ElevationScans[elv], product)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	c.JSON(200, r)
}

func l2FileRenderHandler(c *gin.Context) {
	fn := c.Param("fn")
	elv, err := strconv.Atoi(c.Param("elv"))
	if err != nil || elv < 1 {
		c.AbortWithError(http.StatusBadRequest, errors.New("Invalid elv"))
		return
	}

	product := strings.ToLower(c.Param("product"))

	ar2, err := ChunkCache.GetFileWithElevation(fn, elv)
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
	if _, ok := c.GetQuery("nolut"); ok {
		lut = render.DefaultLUT("")
	}

	pngFile := render.RenderAndReproject(r, lut, 6000, 2600)
	png, _ := ioutil.ReadAll(pngFile)
	pngFile.Close()

	// Strong client caching: rendered outputs are immutable per file/product/elevation
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	// Optional Expires header for intermediaries that honor it
	c.Header("Expires", time.Now().UTC().AddDate(1, 0, 0).Format(http.TimeFormat))
	c.Data(http.StatusOK, "image/png", png)
}
