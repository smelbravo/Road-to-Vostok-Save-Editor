# Road to Vostok Save Editor

A desktop save file editor for [Road to Vostok](https://store.steampowered.com/app/1963610/Road_to_Vostok/). Edit your character inventory, equipment, world settings, and more.

> **This is a Build 2 update, not an original project.** The editor was created by [FINDarkside](https://github.com/FINDarkside/Road-to-Vostok-Save-Editor) and is released under the MIT license. This fork by smelbravo updates it for Road to Vostok **Build 2**, adds support for **Gear Storage Expansion (GSE)** and makes it work with other mods. All credit for the original editor goes to FINDarkside.

**[Download latest release](https://github.com/smelbravo/Road-to-Vostok-Save-Editor/releases)**

## What is new in this version

- Build 2 save files.
- **Save slots**: works with Save Slots and Multi Save Slots Reborn (choose the slot in Settings).
- **Mod profiles**: understands Metro Mod Loader and RTV Mod Manager profiles.
- **Game items** are read from the game files, so new items appear without an editor update.
- **Gear Storage** tab: edit what is stored in backpacks, rigs and clothing with Gear Storage Expansion (gun slots, magazine pouches, medical pouches, open grids).
- Items added by installed mods get their real name, size, category and icon (png/jpg/webp, `.ctex`, and `.res` textures including compressed ones), and can be filtered with the **Modded** chip when adding items.
- Gear Storage items have the same right-click menu as the inventory.
- Gear Storage weapons can be swapped for another weapon from a chevron picker; old backups can be deleted from the Backups tab.
- Mod Settings tab: edit the settings Mod Configuration Menu (MCM) saved for each mod, for the active profile or any other.
- Shelter tab: browse what every shelter stores, with search, and edit it in Edit mode (condition, quantity, remove, add). Garage can be unlocked in World.
- Modded weapons show their equipped attachments on the icon and can be edited in the weapon workbench; compatibility and positions are read from the mod's own files.

See [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm install
npm run dev
```

Checks that need no game files: `npx tsx scripts/test-storage-codec.ts` and `npx tsx scripts/test-mod-scan.ts`.

## License

MIT. Original work © FINDarkside, Build 2 update © smelbravo.
