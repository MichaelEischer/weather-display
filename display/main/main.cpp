#include "Arduino.h"
#include "pins_arduino.h"
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>


#define TFT_SCLK D8
// not really, the pin is not connected. But the library seems to fall apart without it.
#define TFT_MISO D9
#define TFT_MOSI D10
#define TFT_CS D1 // Chip select control pin
#define TFT_DC D3 // Data Command control pin
#define TFT_BUSY D2
#define TFT_RST D0 // Reset pin (could connect to RST pin)

#define SPI_FREQUENCY 10000000
#define TFT_SPI_MODE SPI_MODE0

// Create a global SPI instance
SPIClass spi = SPIClass(FSPI);

GxEPD2_BW<GxEPD2_426_GDEQ0426T82, GxEPD2_426_GDEQ0426T82::HEIGHT> display(GxEPD2_426_GDEQ0426T82(
  TFT_CS, TFT_DC, TFT_RST, TFT_BUSY)); // GDEQ0426T82 480x800, SSD1677 (P426010-MF1-A)

void setup()
{
  // Serial.begin(115200);
  // delay(100);

  // Initialize SPI with correct pins
  spi.begin(TFT_SCLK, TFT_MISO, TFT_MOSI, -1);
  display.epd2.selectSPI(spi, SPISettings(SPI_FREQUENCY, MSBFIRST, TFT_SPI_MODE));
  display.init(115200, true, 10, false);

  display.init(115200, true);
  display.clearScreen(GxEPD_WHITE);
  display.hibernate();
}

const char HelloWorld[] = "Hello World!";

void loop() {
  display.setRotation(3);
  display.setFont(&FreeMonoBold9pt7b);
  display.setTextColor(GxEPD_BLACK);
  display.setFullWindow();
  
  int16_t tbx, tby; uint16_t tbw, tbh;
  display.getTextBounds(HelloWorld, 0, 0, &tbx, &tby, &tbw, &tbh);
  // center the bounding box by transposition of the origin:
  uint16_t x = ((display.width() - tbw) / 2) - tbx;
  uint16_t y = ((display.height() - tbh) / 2) - tby;

  for (int i = 0 ; i < 50; i++) {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(x, i * 10 + 20);
    display.print(HelloWorld);
    display.display(true);
    display.hibernate();

    delay(10000);
  }
};

extern "C" void app_main()
{
  initArduino();

  setup();

  // Arduino-like loop()
  while(true){
    loop();
  }

  // WARNING: if program reaches end of function app_main() the MCU will restart.
}
