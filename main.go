package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-contrib/cache"
	"github.com/gin-contrib/cache/persistence"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// Wrap cache.CachePage and also emit client-side Cache-Control/Expires headers
func cachePageWithClientHeaders(store persistence.CacheStore, expiration time.Duration, h gin.HandlerFunc) gin.HandlerFunc {
	ch := cache.CachePage(store, expiration, h)
	return func(c *gin.Context) {
		// Add headers before invoking cached handler
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d", int(expiration.Seconds())))
		c.Header("Expires", time.Now().UTC().Add(expiration).Format(http.TimeFormat))
		ch(c)
	}
}

func main() {
	verbose := flag.Bool("verbose", false, "Verbose mode")
	flag.Parse()

	if *verbose {
		logrus.SetLevel(logrus.DebugLevel)
	}

	r := gin.Default()
	store := persistence.NewInMemoryStore(time.Minute)

	// API routes
	r.GET("/api/l2", cachePageWithClientHeaders(store, 24*time.Hour, l2ListSitesHandler))
	r.GET("/api/l2/:site", cachePageWithClientHeaders(store, 1*time.Minute, l2ListFilesHandler))
	r.GET("/api/l2/:site/date/:date", cachePageWithClientHeaders(store, 1*time.Minute, l2ListFilesHandler))
	r.GET("/api/l2/:site/:fn", cachePageWithClientHeaders(store, 1*time.Hour, l2FileMetaHandler))
	r.GET("/api/l2/:site/:fn/:product/isosurface/:threshold", cachePageWithClientHeaders(store, 1*time.Hour, l2FileIsosurfaceHandler))
	r.GET("/api/l2/:site/:fn/:product/:elv/radial", l2FileRadialHandler)
	r.GET("/api/l2/:site/:fn/:product/:elv/render", l2FileRenderHandler)

	r.GET("/api/l2-realtime/:site/:volume", realtimeMetaHandler)
	r.GET("/api/l2-realtime/:site/:volume/:elv/:product/render", realtimeRenderHandler)

	r.GET("/api/l3", cachePageWithClientHeaders(store, 24*time.Hour, l3ListSitesHandler))
	r.GET("/api/l3/:site", cachePageWithClientHeaders(store, 24*time.Hour, l3ListProductsHandler))
	r.GET("/api/l3/:site/:product", cachePageWithClientHeaders(store, 1*time.Minute, l3ListFilesHandler))
	r.GET("/api/l3/:site/:product/date/:date", cachePageWithClientHeaders(store, 1*time.Minute, l3ListFilesByDateHandler))
	r.GET("/api/l3/:site/:product/:fn", cachePageWithClientHeaders(store, 1*time.Hour, l3FileMetaHandler))
	r.GET("/api/l3/:site/:product/:fn/radial", l3FileRadialHandler)
	r.GET("/api/l3/:site/:product/:fn/render", l3FileRenderHandler)

	// Static files - specific routes first, then fallback
	r.Static("/assets", "./web/dist/assets")
	r.StaticFile("/nexrad.kml", "./nexrad.kml")
	r.GET("/", func(c *gin.Context) { c.File("./web/dist/index.html") })
	r.NoRoute(func(c *gin.Context) { c.File("./web/dist/index.html") })

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	r.Run(":" + port)
}
