package machine

import "testing"

func TestMeminfoTotal(t *testing.T) {
	if got := meminfoTotal("MemFree: 1 kB\nMemTotal:       32621212 kB\n"); got != 32621212*1024 {
		t.Fatalf("MemTotal: %d", got)
	}
	if got := meminfoTotal("nada"); got != 0 {
		t.Fatalf("sin MemTotal debe dar 0, dio %d", got)
	}
}

func TestCPUInfoModel(t *testing.T) {
	if got := cpuinfoModel("processor\t: 0\nmodel name\t: 12th Gen Intel(R) Core(TM) i7-12700K\n"); got != "12th Gen Intel(R) Core(TM) i7-12700K" {
		t.Fatalf("model name: %q", got)
	}
}

func TestNvidiaPicksTheLargest(t *testing.T) {
	name, vram, ok := nvidia("NVIDIA GeForce GT 710, 2048\nNVIDIA GeForce RTX 3070, 8192")
	if !ok || name != "NVIDIA GeForce RTX 3070" || vram != 8192*1024*1024 {
		t.Fatalf("nvidia: %q %d %v", name, vram, ok)
	}
	if _, _, ok := nvidia(""); ok {
		t.Fatal("sin salida de nvidia-smi no hay GPU")
	}
}

func TestDetectNeverEmpty(t *testing.T) {
	m := Detect()
	if m.ID == "" || m.Label == "" || m.Here == "" || m.Accel == "" {
		t.Fatalf("Detect dejó algo vacío: %+v", m)
	}
}
