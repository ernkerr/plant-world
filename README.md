# Plant World

A little Mario-style Game Boy game, starring a plant in a pot. Play it in the
browser on a light blue Game Boy Advance SP at
**https://ernkerr.github.io/plant-world/**, or download `plant-world.gb` and
play it on a real Game Boy with a flash cart.

## Play

- Run left and right, and climb the pothos vines up and down.
- **A** jumps. Hold it for a higher jump.
- **Start** leaves a level for the world map.
- Grab the coins, stomp the bugs from above, and reach the flag. There are five
  levels on the world map.

On a keyboard: arrows (or WASD) move, **X** or **Space** is A, **Z** is B,
**Enter** is Start. On a phone, use the buttons on the SP. Game controllers
work too.

Like a real SP, the game sits in the middle of the wider screen. Press **L** or
**R** to stretch it to fill the screen, and the light button to turn the
screen light off.

High scores and unlocked levels save in your browser, like the battery save on
a real cartridge.

## How it works

The page runs [binjgb](https://github.com/binji/binjgb), Ben Smith's Game Boy
emulator, compiled to WebAssembly (`vendor/`). The cartridge supports Game Boy
Color, so it plays in color, as it does on an SP. On an original Game Boy it
plays in four shades.

No build step. Serve the folder with any static server:

```sh
python3 -m http.server
```

## Files

| file | what it is |
| --- | --- |
| `index.html`, `css/style.css` | the page and the SP, drawn in CSS |
| `js/main.js` | loads the cartridge, draws frames, plays sound, saves, reads buttons |
| `plant-world.gb` | the game |
| `vendor/` | binjgb (MIT) |

## Credits

Game by Erin Kerr. Emulator: binjgb by Ben Smith (MIT, see
`vendor/LICENSE-binjgb.txt`). Fonts from Google Fonts: Geist and Newsreader
(both OFL). Game Boy and Game Boy Advance SP are trademarks of Nintendo; this
project isn't affiliated with Nintendo.
