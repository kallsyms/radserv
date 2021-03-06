package render

import (
	"image/color"
)

func dbzColorNOAA(dbz float64) color.Color {
	if dbz < 5.0 {
		return color.NRGBA{0x00, 0x00, 0x00, 0x00}
	} else if dbz >= 5.0 && dbz < 10.0 {
		return color.NRGBA{0x40, 0xe8, 0xe3, 0xFF}
	} else if dbz >= 10.0 && dbz < 15.0 {
		// 26A4FA
		return color.NRGBA{0x26, 0xa4, 0xfa, 0xFF}
	} else if dbz >= 15.0 && dbz < 20.0 {
		// 0030ED
		return color.NRGBA{0x00, 0x30, 0xed, 0xFF}
	} else if dbz >= 20.0 && dbz < 25.0 {
		// 49FB3E
		return color.NRGBA{0x49, 0xfb, 0x3e, 0xFF}
	} else if dbz >= 25.0 && dbz < 30.0 {
		// 36C22E
		return color.NRGBA{0x36, 0xc2, 0x2e, 0xFF}
	} else if dbz >= 30.0 && dbz < 35.0 {
		// 278C1E
		return color.NRGBA{0x27, 0x8c, 0x1e, 0xFF}
	} else if dbz >= 35.0 && dbz < 40.0 {
		// FEF543
		return color.NRGBA{0xfe, 0xf5, 0x43, 0xFF}
	} else if dbz >= 40.0 && dbz < 45.0 {
		// EBB433
		return color.NRGBA{0xeb, 0xb4, 0x33, 0xFF}
	} else if dbz >= 45.0 && dbz < 50.0 {
		// F6952E
		return color.NRGBA{0xf6, 0x95, 0x2e, 0xFF}
	} else if dbz >= 50.0 && dbz < 55.0 {
		// F80A26
		return color.NRGBA{0xf8, 0x0a, 0x26, 0xFF}
	} else if dbz >= 55.0 && dbz < 60.0 {
		// CB0516
		return color.NRGBA{0xcb, 0x05, 0x16, 0xFF}
	} else if dbz >= 60.0 && dbz < 65.0 {
		// A90813
		return color.NRGBA{0xa9, 0x08, 0x13, 0xFF}
	} else if dbz >= 65.0 && dbz < 70.0 {
		// EE34FA
		return color.NRGBA{0xee, 0x34, 0xfa, 0xFF}
	} else if dbz >= 70.0 && dbz < 75.0 {
		return color.NRGBA{0x91, 0x61, 0xc4, 0xFF}
	}
	return color.NRGBA{0xff, 0xff, 0xFF, 0xFF}
}

// TODO
func velColorRadarscope(vel float64) color.Color {
	colors := []color.Color{
		color.NRGBA{0xF9, 0x14, 0x73, 0xff}, // 140
		color.NRGBA{0xAA, 0x10, 0x79, 0xff}, // 130
		color.NRGBA{0x6E, 0x0E, 0x80, 0xff}, // 120
		color.NRGBA{0x2E, 0x0E, 0x84, 0xff}, // 110
		color.NRGBA{0x15, 0x1F, 0x93, 0xff}, // 100
		color.NRGBA{0x23, 0x6F, 0xB3, 0xff}, // 90
		color.NRGBA{0x41, 0xDA, 0xDB, 0xff}, // 80
		color.NRGBA{0x66, 0xE1, 0xE2, 0xff}, // 70
		color.NRGBA{0x9E, 0xE8, 0xEA, 0xff}, // 60
		color.NRGBA{0x57, 0xFA, 0x63, 0xff}, // 50
		color.NRGBA{0x31, 0xE3, 0x2B, 0xff}, // 40
		// color.NRGBA{0x21, 0xBE, 0x0A, 0xff}, // 35
		color.NRGBA{0x24, 0xAA, 0x1F, 0xff}, // 30
		color.NRGBA{0x19, 0x76, 0x13, 0xff}, // 20
		color.NRGBA{0x45, 0x67, 0x42, 0xff}, // -10
		color.NRGBA{0x63, 0x4F, 0x50, 0xff}, // 0
		color.NRGBA{0x6e, 0x2e, 0x39, 0xff}, // 10
		color.NRGBA{0x7F, 0x03, 0x0C, 0xff}, // 20
		color.NRGBA{0xB6, 0x07, 0x16, 0xff}, // 30
		// color.NRGBA{0xC5, 0x00, 0x0D, 0xff}, // 35
		color.NRGBA{0xF3, 0x22, 0x45, 0xff}, // 40
		color.NRGBA{0xF6, 0x50, 0x8A, 0xff}, // 50
		color.NRGBA{0xFB, 0x8B, 0xBF, 0xff}, // 60
		color.NRGBA{0xFD, 0xDE, 0x93, 0xff}, // 70
		color.NRGBA{0xFC, 0xB4, 0x70, 0xff}, // 80
		color.NRGBA{0xFA, 0x81, 0x4B, 0xff}, // 90
		color.NRGBA{0xDD, 0x60, 0x3C, 0xff}, // 100
		color.NRGBA{0xB7, 0x45, 0x2D, 0xff}, // 110
		color.NRGBA{0x93, 0x2C, 0x20, 0xff}, // 120
		color.NRGBA{0x71, 0x16, 0x14, 0xff}, // 130
		color.NRGBA{0x52, 0x01, 0x06, 0xff}, // 140
	}

	// if vel < -140 {
	// 	return color.NRGBA{0x69, 0x1A, 0xC1, 0xff} // -140+
	// } else if vel > 140 {
	// 	return color.NRGBA{0xff, 0xff, 0xff, 0xff} // 140+
	// }

	i := scaleInt(int32(vel), 140, -140, int32(len(colors))-1, 0)
	// logrus.Debugf("converted %4f to %2d", vel, i)
	return colors[i]
}

// scaleInt scales a number form one range to another range
func scaleInt(value, oldMax, oldMin, newMax, newMin int32) int32 {
	oldRange := (oldMax - oldMin)
	newRange := (newMax - newMin)
	return (((value - oldMin) * newRange) / oldRange) + newMin
}

func DefaultLUT(product string) func(float64) color.Color {
	switch product {
	case "ref":
		return dbzColorNOAA
	case "vel":
		return velColorRadarscope
	default:
		return func(f float64) color.Color {
			// 0-255 grayscale
			return color.NRGBA{uint8(f), uint8(f), uint8(f), 0xff}
		}
	}
}
