# TFT Archipelago

Source code of TFT Archipelago, an [Archipelago](https://archipelago.gg) world for Teamfight Tactics.

TFT is a server-side online game, so nothing is modded. A Windows companion app is the Archipelago client:
it tracks your matches, shows your checks, and covers locked buttons with click blockers. It never touches
the game, its memory or its input.

**Download and setup:** [tft-archipelago-releases](https://github.com/Alpaka623/tft-archipelago-releases/releases/latest).
The setup guide is in [worlds/tft_archipelago/docs/setup_en.md](worlds/tft_archipelago/docs/setup_en.md).

Not affiliated with or endorsed by Riot Games.

## How it works

- You start with no shop rerolls, no XP buys, no augment rerolls, only the middle augment and three of five
  shop slots. Archipelago items unlock them step by step.
- Checks are board compositions and milestones, validated at the end of a match.
- Going over a limit invalidates the current match, and it sends no checks.

The app reads the game in two ways, both without touching the game process:

- **Screen reading** of the TFT window (shop, augments, gold, level) for live rule tracking.
- **The Riot client's local API and TFT's log files** for match start, placement and the final board.

## Project layout

| Path | Contents |
| --- | --- |
| `electron/` | Electron main process: windows, game window detection, Riot client API, auto-update |
| `src/background/` | Background controller: Archipelago connection, rule engine, event detection |
| `src/vision/` | Screen reading of the TFT window |
| `src/desktop/` | Desktop tracker (connection, checks, inventory, setup, FAQ) |
| `src/overlay/`, `src/shop-blocker/` | In-game overlay and click blockers |
| `src/platform/` | Platform layer shared by the Electron and Overwolf builds |
| `src/data/` | Item IDs, locations and TFT set data |
| `worlds/tft_archipelago/` | The APWorld (Python) |
| `scripts/` | Data import, APWorld packaging, release tooling |

## Building

Requires Node.js 22 and Windows.

```sh
npm install
npm run electron      # build and start the app
npm run dist          # build the Windows installer into release/
npm test              # unit tests
npm run lint
npm run typecheck
```

`npm run electron:fake-game` starts the app with a simulated game window for development.

The APWorld tests run inside an Archipelago source checkout: copy `worlds/tft_archipelago` into its
`worlds/` folder and run its test suite.

## License

[MIT](LICENSE)
