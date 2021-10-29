package main

import (
	"context"
	"io/ioutil"
	"net/http"
	"path/filepath"

	"cloud.google.com/go/storage"
	"github.com/gin-gonic/gin"
	"github.com/kallsyms/radserv/level3"
	"github.com/kallsyms/radserv/render"
	"github.com/sirupsen/logrus"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

const L3_BUCKET = "gcp-public-data-nexrad-l3-realtime"

func listGCS(ctx context.Context, bucket *storage.BucketHandle, prefix string) ([]string, []string) {
	blobs := []string{}
	dirs := []string{}

	it := bucket.Objects(ctx, &storage.Query{
		Prefix:    prefix,
		Delimiter: "/",
	})

	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			logrus.Errorf("Bucket.Objects: %v", err)
			break
		}
		if attrs.Prefix != "" {
			dirs = append(dirs, filepath.Base(attrs.Prefix))
		} else {
			blobs = append(blobs, filepath.Base(attrs.Name))
		}
	}

	return blobs, dirs
}

func l3ListSitesHandler(c *gin.Context) {
	client, err := storage.NewClient(context.Background(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()
	_, sites := listGCS(context.Background(), client.Bucket(L3_BUCKET), "NIDS/")

	c.JSON(200, sites)
}

func l3ListProductsHandler(c *gin.Context) {
	site := c.Param("site")

	client, err := storage.NewClient(context.Background(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()
	_, products := listGCS(context.Background(), client.Bucket(L3_BUCKET), "NIDS/"+site+"/")

	c.JSON(200, products)
}

func l3ListFilesHandler(c *gin.Context) {
	site := c.Param("site")
	product := c.Param("product")

	client, err := storage.NewClient(context.Background(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()
	files, _ := listGCS(context.Background(), client.Bucket(L3_BUCKET), "NIDS/"+site+"/"+product+"/")

	c.JSON(200, files)
}

func l3FileMetaHandler(c *gin.Context) {
	site := c.Param("site")
	product := c.Param("product")
	fn := c.Param("fn")

	client, err := storage.NewClient(context.Background(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()

	radFileReader, err := client.Bucket(L3_BUCKET).Object("NIDS/" + site + "/" + product + "/" + fn).NewReader(context.Background())
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	l3, err := level3.NewLevel3(radFileReader)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	c.JSON(200, l3)
}

func l3radial(c *gin.Context) (*render.RadialSet, error) {
	site := c.Param("site")
	product := c.Param("product")
	fn := c.Param("fn")

	client, err := storage.NewClient(context.Background(), option.WithCredentialsFile("service_account.json"))
	defer client.Close()

	radFileReader, err := client.Bucket(L3_BUCKET).Object("NIDS/" + site + "/" + product + "/" + fn).NewReader(context.Background())
	if err != nil {
		return nil, err
	}

	l3, err := level3.NewLevel3(radFileReader)
	if err != nil {
		return nil, err
	}

	r, err := render.RadialSetFromLevel3(l3)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return nil, err
	}

	return r, nil
}

func l3FileRadialHandler(c *gin.Context) {
	r, err := l3radial(c)

	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	c.JSON(200, r)
}

func l3FileRenderHandler(c *gin.Context) {
	r, err := l3radial(c)

	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}

	// TODO: product here is N_Q, N_S, etc. not ref/vel
	product := c.Param("product")
	lut := render.DefaultLUT(product)

	pngFile := render.RenderAndReproject(r, lut, 6000, 2600)
	png, _ := ioutil.ReadAll(pngFile)
	pngFile.Close()

	c.Data(http.StatusOK, "image/png", png)
}
