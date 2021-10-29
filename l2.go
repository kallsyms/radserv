package main

import (
	"errors"
	"io/ioutil"
	"net/http"
	"path/filepath"
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
	bucket := aws.String("noaa-nexrad-level2")

	// check yesterday to get a list of all radars
	t := time.Now().UTC().AddDate(0, 0, -1)
	resp, err := svc.ListObjectsV2(&s3.ListObjectsV2Input{
		Bucket:    bucket,
		Prefix:    aws.String(t.Format("2006/01/02/")),
		Delimiter: aws.String("/"),
	})
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	sites := make([]string, 0, len(resp.CommonPrefixes))
	for _, d := range resp.CommonPrefixes {
		sites = append(sites, filepath.Base(*d.Prefix))
	}

	c.JSON(200, sites)
}

func l2ListFilesHandler(c *gin.Context) {
	site := c.Param("site")

	sess, _ := session.NewSession(&aws.Config{
		Credentials: credentials.AnonymousCredentials,
		Region:      aws.String("us-east-1"),
	})
	svc := s3.New(sess)
	bucket := aws.String("noaa-nexrad-level2")

	now := time.Now().UTC()
	resp, err := svc.ListObjectsV2(&s3.ListObjectsV2Input{
		Bucket: bucket,
		Prefix: aws.String(now.Format("2006/01/02/") + site),
	})
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	files := make([]string, 0, len(resp.Contents))
	for _, d := range resp.Contents {
		files = append(files, filepath.Base(*d.Key))
	}

	if len(files) < 30 {
		now = now.AddDate(0, 0, -1)
		resp, err = svc.ListObjectsV2(&s3.ListObjectsV2Input{
			Bucket: bucket,
			Prefix: aws.String(now.Format("2006/01/02/") + site),
		})
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		pastFiles := make([]string, 0, len(resp.Contents))
		for _, d := range resp.Contents {
			pastFiles = append(pastFiles, filepath.Base(*d.Key))
		}
		files = append(pastFiles, files...)
	}

	files = files[len(files)-30:]

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
	lut := render.DefaultLUT(product)

	pngFile := render.RenderAndReproject(r, lut, 6000, 2600)
	png, _ := ioutil.ReadAll(pngFile)
	pngFile.Close()

	c.Data(http.StatusOK, "image/png", png)
}
