package main

import (
	"flag"
	"time"

	"github.com/gin-contrib/cache"
	"github.com/gin-contrib/cache/persistence"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

func main() {
	verbose := flag.Bool("verbose", false, "Verbose mode")
	flag.Parse()

	if *verbose {
		logrus.SetLevel(logrus.DebugLevel)
	}

	r := gin.Default()
	store := persistence.NewInMemoryStore(time.Minute)

	r.GET("/l2", cache.CachePage(store, 24*time.Hour, l2ListSitesHandler))
	r.GET("/l2/:site", cache.CachePage(store, 1*time.Minute, l2ListFilesHandler))
	r.GET("/l2/:site/date/:date", cache.CachePage(store, 1*time.Minute, l2ListFilesHandler))
	r.GET("/l2/:site/:fn", cache.CachePage(store, 1*time.Hour, l2FileMetaHandler))
	r.GET("/l2/:site/:fn/:product/isosurface/:threshold", cache.CachePage(store, 1*time.Hour, l2FileIsosurfaceHandler))
	r.GET("/l2/:site/:fn/:product/:elv/radial", l2FileRadialHandler)
	r.GET("/l2/:site/:fn/:product/:elv/render", l2FileRenderHandler)

	r.GET("/l2-realtime/:site/:volume", realtimeMetaHandler)
	r.GET("/l2-realtime/:site/:volume/:elv/:product/render", realtimeRenderHandler)

	r.GET("/l3", cache.CachePage(store, 24*time.Hour, l3ListSitesHandler))
	r.GET("/l3/:site", cache.CachePage(store, 24*time.Hour, l3ListProductsHandler))
	r.GET("/l3/:site/:product", cache.CachePage(store, 1*time.Minute, l3ListFilesHandler))
	r.GET("/l3/:site/:product/date/:date", cache.CachePage(store, 1*time.Minute, l3ListFilesByDateHandler))
	r.GET("/l3/:site/:product/:fn", cache.CachePage(store, 1*time.Hour, l3FileMetaHandler))
	r.GET("/l3/:site/:product/:fn/radial", l3FileRadialHandler)
	r.GET("/l3/:site/:product/:fn/render", l3FileRenderHandler)

	// Serve production frontend build (if present)
	r.Static("/assets", "./web/dist/assets")
	r.StaticFile("/nexrad.kml", "./nexrad.kml")
	r.StaticFile("/", "./web/dist/index.html")
	r.NoRoute(func(c *gin.Context) { c.File("./web/dist/index.html") })

	r.Run(":8081")
}
