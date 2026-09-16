# ==============================================================
#  Firmware ESP32 - lop bao ngoai PlatformIO
#
#    make            xem danh sach lenh
#    make flash      nap + mo serial  (hay dung nhat)
#    make build      chi bien dich
#
#  Bien: PORT=/dev/ttyUSB0  BAUD=115200  ENV=esp32dev
# ==============================================================

SHELL     := /bin/bash
HERE      := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

ENV       ?= esp32dev
BAUD      ?= 115200
PORT      ?=

PIO       := pio
SECRETS   := $(HERE)/include/secrets.h
EXAMPLE   := $(HERE)/include/secrets.example.h
BIN       := $(HERE)/.pio/build/$(ENV)/firmware.bin

# PORT rong = de PlatformIO tu do cong
PORT_ARG  := $(if $(PORT),--upload-port $(PORT),)
MON_ARG   := $(if $(PORT),--port $(PORT),)

.DEFAULT_GOAL := help
.PHONY: help check secrets build upload flash monitor clean erase size ports

# ---------------------------------------------------------------- tro giup
help:
	@echo ""
	@echo "  Firmware ESP32 - $(ENV)"
	@echo "  ---------------------------------------------------------------"
	@echo "    make build      Bien dich"
	@echo "    make upload     Bien dich + nap len board"
	@echo "    make flash      Nap roi mo serial luon  <- hay dung nhat"
	@echo "    make monitor    Chi mo serial ($(BAUD) baud, Ctrl-C de thoat)"
	@echo ""
	@echo "    make size       Firmware chiem bao nhieu RAM / Flash"
	@echo "    make ports      Liet ke cong serial dang co"
	@echo "    make secrets    Tao include/secrets.h tu mau"
	@echo "    make clean      Xoa thu muc build"
	@echo "    make erase      XOA SACH FLASH - mat ca lich va device_id"
	@echo ""
	@echo "  Bien: PORT=/dev/ttyUSB0   BAUD=$(BAUD)   ENV=$(ENV)"
	@echo "  Vi du: make flash PORT=/dev/ttyUSB0"
	@echo ""

# ---------------------------------------------------------------- kiem tra
check:
	@command -v $(PIO) >/dev/null || { \
		echo "THIEU: PlatformIO. Cai bang:  pip install platformio"; exit 1; }
	@test -f $(SECRETS) || { \
		echo ""; \
		echo "THIEU: include/secrets.h (WiFi + broker)."; \
		echo "Chay:  make secrets   roi mo file do dien thong tin that."; \
		echo ""; exit 1; }

# ---------------------------------------------------------------- secrets
secrets:
	@if [ -f $(SECRETS) ]; then \
		echo "==> include/secrets.h da co, khong ghi de"; \
	else \
		cp $(EXAMPLE) $(SECRETS); \
		echo "==> da tao include/secrets.h"; \
		echo "    NHO sua CFG_WIFI_SSID / CFG_WIFI_PASS / CFG_MQTT_HOST"; \
	fi

# ---------------------------------------------------------------- build
build: check
	@$(PIO) run -e $(ENV)

upload: check
	@$(PIO) run -e $(ENV) -t upload $(PORT_ARG)

# Nap xong mo serial ngay - vong lap thuong dung nhat khi sua firmware.
flash: check
	@$(PIO) run -e $(ENV) -t upload $(PORT_ARG)
	@echo ""
	@echo "==> mo serial, Ctrl-C de thoat"
	@$(PIO) device monitor -b $(BAUD) $(MON_ARG)

monitor:
	@echo "Ctrl-C de thoat"
	@$(PIO) device monitor -b $(BAUD) $(MON_ARG)

size: check
	@$(PIO) run -e $(ENV) -t size

ports:
	@echo ""
	@echo "  Cong co the la board (USB-UART):"
	@if ls /dev/ttyUSB* /dev/ttyACM* >/dev/null 2>&1; then \
		ls /dev/ttyUSB* /dev/ttyACM* | sed 's/^/    /'; \
	else \
		echo "    khong thay cong nao - board da cam chua? day USB co truyen du lieu khong?"; \
	fi
	@echo ""
	@echo "  Day du:  pio device list"
	@echo "  (cac /dev/ttyS* la cong cua bo mach chu, khong phai board)"
	@echo ""

# ---------------------------------------------------------------- don dep
clean:
	@$(PIO) run -e $(ENV) -t clean 2>/dev/null || true
	@rm -rf $(HERE)/.pio
	@echo "==> da xoa .pio"

# Xoa het flash: mat device_id, lich trong NVS, outbox, trang thai den cuoi cung.
# Khong bat buoc khi doi cau truc lich - blob sai magic thi firmware tu bo qua.
erase: check
	@echo ""
	@echo "  XOA SACH FLASH cua board."
	@echo "  Mat: device_id da dat, lich trong NVS, outbox chua gui, trang thai den."
	@echo ""
	@read -p "  Go 'yes' de xac nhan: " a; [ "$$a" = "yes" ] || { echo "  da huy"; exit 1; }
	@$(PIO) run -e $(ENV) -t erase $(PORT_ARG)
