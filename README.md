<p align="center">

<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

<span align="center">

# Homebridge Daikin Central System

</span>

This plugin controls Diakin Central System locally using the Skyfi controller.

## Features:
* Heating and Cooling control.
* Temperature sensor (Indoor only at this time).
* Zones (up to 8).
* Optional logging of temperature sensor via http.
--------------------------------------------------------------------
* Fan and Dehumidification control may be supported in the future.
* Humid sensor may be supported in the future.

#### v1.1
* There are instances where failed communication attempt to the AC controller results in the state being out of sync, thus; the communication with AC controller have been made to be robust.