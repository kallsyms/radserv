package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io/ioutil"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/storage"
	"github.com/gin-gonic/gin"
	"github.com/kallsyms/radserv/level3"
	"github.com/kallsyms/radserv/render"
	"github.com/sirupsen/logrus"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

const L3_BUCKET = "gcp-public-data-nexrad-l3-realtime"
const L3_ARCHIVE_BUCKET = "gcp-public-data-nexrad-l3"

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
	client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()
	_, sites := listGCS(c.Request.Context(), client.Bucket(L3_BUCKET), "NIDS/")

	c.JSON(200, sites)
}

func l3ListProductsHandler(c *gin.Context) {
	site := c.Param("site")

	client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()
	_, products := listGCS(c.Request.Context(), client.Bucket(L3_BUCKET), "NIDS/"+site+"/")

	c.JSON(200, products)
}

func l3ListFilesHandler(c *gin.Context) {
	site := c.Param("site")
	product := c.Param("product")

	client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()
	files, _ := listGCS(c.Request.Context(), client.Bucket(L3_BUCKET), "NIDS/"+site+"/"+product+"/")
	// Filter out _MDM suffixed files
	out := make([]string, 0, len(files))
	for _, f := range files {
		if isMDMFile(f) {
			continue
		}
		out = append(out, f)
	}
	c.JSON(200, out)
}

func l3ListFilesByDateHandler(c *gin.Context) {
	site := c.Param("site")
	product := c.Param("product")
	dateParam := c.Param("date")

	// If latest, delegate to realtime listing
	if dateParam == "latest" || dateParam == "" {
		l3ListFilesHandler(c)
		return
	}

	// Parse YYYYMMDD
	t, err := time.Parse("20060102", dateParam)
	if err != nil {
		c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()

	// Construct archive tarball path: YYYY/MM/DD/<SITE4>/NWS_NEXRAD_NXL3_<SITE4>_<YYYYMMDD>000000_<YYYYMMDD>235959.tar.gz
	site4 := strings.ToUpper(site)
	if len(site4) == 3 {
		site4 = "K" + site4
	}
	tarObj := fmt.Sprintf("%04d/%02d/%02d/%s/NWS_NEXRAD_NXL3_%s_%s000000_%s235959.tar.gz",
		t.Year(), t.Month(), t.Day(), site4, site4, t.Format("20060102"), t.Format("20060102"))

	rc, err := client.Bucket(L3_ARCHIVE_BUCKET).Object(tarObj).NewReader(c.Request.Context())
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer rc.Close()
	gz, err := gzip.NewReader(rc)
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	files := []string{}
	for {
		hdr, err := tr.Next()
		if err != nil {
			break
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		base := filepath.Base(hdr.Name)
		if isMDMFile(base) {
			continue
		}
		// Expect filenames like KOHX_SDUS84_N3HOHX_YYYYMMDDHHMM
		parts := strings.Split(base, "_")
		if len(parts) < 3 {
			continue
		}
		prodSite := parts[2] // e.g., N3HOHX
		if len(prodSite) < 3 {
			continue
		}
		code := prodSite[0:3]
		if strings.EqualFold(code, product) {
			files = append(files, base)
		}
	}
	c.JSON(200, files)
}

func l3FileMetaHandler(c *gin.Context) {
	site := c.Param("site")
	product := c.Param("product")
	fn := c.Param("fn")

	dateQ := c.Query("date")
	if dateQ != "" && dateQ != "latest" {
		// Read from archive tarball
		t, err := time.Parse("20060102", dateQ)
		if err != nil {
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}
		client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		defer client.Close()
		site4 := strings.ToUpper(site)
		if len(site4) == 3 {
			site4 = "K" + site4
		}
		tarObj := fmt.Sprintf("%04d/%02d/%02d/%s/NWS_NEXRAD_NXL3_%s_%s000000_%s235959.tar.gz",
			t.Year(), t.Month(), t.Day(), site4, site4, t.Format("20060102"), t.Format("20060102"))
		rc, err := client.Bucket(L3_ARCHIVE_BUCKET).Object(tarObj).NewReader(c.Request.Context())
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		defer rc.Close()
		gz, err := gzip.NewReader(rc)
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		defer gz.Close()
		tr := tar.NewReader(gz)
		for {
			hdr, err := tr.Next()
			if err != nil {
				break
			}
			if hdr.Typeflag != tar.TypeReg {
				continue
			}
			if filepath.Base(hdr.Name) == fn {
				l3, err := level3.NewLevel3(tr)
				if err != nil {
					c.AbortWithError(http.StatusInternalServerError, err)
					return
				}
				c.JSON(200, l3)
				return
			}
		}
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	// Realtime bucket
	client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer client.Close()

	radFileReader, err := client.Bucket(L3_BUCKET).Object("NIDS/" + site + "/" + product + "/" + fn).NewReader(c.Request.Context())
	if err != nil {
		c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	defer radFileReader.Close()
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

	client, err := storage.NewClient(c.Request.Context(), option.WithCredentialsFile("service_account.json"))
	defer client.Close()

	// Optional date query to select archive
	dateQ := c.Query("date")
	if dateQ != "" && dateQ != "latest" {
		t, err := time.Parse("20060102", dateQ)
		if err != nil {
			return nil, err
		}
		site4 := strings.ToUpper(site)
		if len(site4) == 3 {
			site4 = "K" + site4
		}
		tarObj := fmt.Sprintf("%04d/%02d/%02d/%s/NWS_NEXRAD_NXL3_%s_%s000000_%s235959.tar.gz",
			t.Year(), t.Month(), t.Day(), site4, site4, t.Format("20060102"), t.Format("20060102"))
		rc, err := client.Bucket(L3_ARCHIVE_BUCKET).Object(tarObj).NewReader(c.Request.Context())
		if err != nil {
			return nil, err
		}
		gz, err := gzip.NewReader(rc)
		if err != nil {
			rc.Close()
			return nil, err
		}
		tr := tar.NewReader(gz)
		// Iterate to target file
		for {
			hdr, err := tr.Next()
			if err != nil {
				gz.Close()
				rc.Close()
				return nil, err
			}
			if hdr.Typeflag != tar.TypeReg {
				continue
			}
			if filepath.Base(hdr.Name) == fn {
				l3, err := level3.NewLevel3(tr)
				gz.Close()
				rc.Close()
				if err != nil {
					return nil, err
				}
				r, err := render.RadialSetFromLevel3(l3)
				if err != nil {
					return nil, err
				}
				return r, nil
			}
		}
	}

	reader, err := client.Bucket(L3_BUCKET).Object("NIDS/" + site + "/" + product + "/" + fn).NewReader(c.Request.Context())
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	l3, err := level3.NewLevel3(reader)
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

	// Strong client caching for immutable rendered assets
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("Expires", time.Now().UTC().AddDate(1, 0, 0).Format(http.TimeFormat))
	c.Data(http.StatusOK, "image/png", png)
}
