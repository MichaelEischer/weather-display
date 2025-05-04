#pragma once

#include <pins_arduino.h>

// Pin definitions
constexpr auto TFT_SCLK = D8;
constexpr auto TFT_MISO = D9;
constexpr auto TFT_MOSI = D10;
constexpr auto TFT_CS = D1;
constexpr auto TFT_DC = D3;
constexpr auto TFT_BUSY = D2;
constexpr auto TFT_RST = D0;
constexpr auto SPI_FREQUENCY = 10000000;
constexpr auto TFT_SPI_MODE = SPI_MODE0;
