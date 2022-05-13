package render

type ElevationSet []*RadialSet

func (es ElevationSet) Len() int           { return len(es) }
func (es ElevationSet) Less(i, j int) bool { return es[i].ElevationAngle < es[j].ElevationAngle }
func (es ElevationSet) Swap(i, j int)      { es[i], es[j] = es[j], es[i] }
