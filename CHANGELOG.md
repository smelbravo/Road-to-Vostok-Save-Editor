# Changelog

## 0.4.0

> Build 2 update by smelbravo, based on FINDarkside's Road to Vostok Save Editor (MIT).

### Highlights

- Updated for **Road to Vostok Build 2**. Save files are read and written with the same overlay codec, so anything the editor does not model (new Build 2 fields, mod data) is kept byte for byte.
- New **Gear Storage** tab with support for **Gear Storage Expansion (GSE)**: see and edit what is stored inside backpacks, rigs, belts and clothing, in the same gun slots, magazine pouches, medical pouches and open grids the mod draws.
- Works with other mods: items added by installed mods are read from your `mods` folder, so modded items get a name, size and category instead of showing up as unknown.

### Gear Storage

- Detects Gear Storage Expansion in the game's `mods` folder (mod id `gse`) and reads the layout you set in MCM, so empty slots appear too.
- Reads the contents of every worn or carried item (`SlotData.storage`), including gear from other mods. Slots that are not part of the layout are still shown instead of being hidden.
- Store new items in a specific slot or grid, change condition and amount, move an item to the inventory or remove it.
- Warns when an item does not normally fit its slot or sits outside its grid.

### Fixes

- Stored items were previously invisible to the editor (the `storage` list was read as a list of external references). It is now read as nested items, written back in the order Godot needs, and cleaned up when the bag is deleted.
- Moving an item between the inventory, equipment and storage keeps its unknown properties.

### Other

- Updates now come from the `smelbravo/Road-to-Vostok-Save-Editor` releases.
- Added `scripts/test-storage-codec.ts` and `scripts/test-mod-scan.ts`.
- The item catalog still needs regenerating from decompiled Build 2 files with `npx tsx scripts/sync-items.ts` to pick up items added in Build 2.

## 0.3.0

### Highlights

- Added furniture catalog editing with grid and list views.
- Added rig armor plate support, including installing, removing, and repairing plates.
- Added drag-and-drop support for moving compatible weapon attachments.

### Inventory Improvements

- Added a **Set Full Condition** action for individual items.
- Added **Repair All** for quickly restoring inventory items.
- Prevented duplication of modded items without a valid game resource path.
- Refreshed the item catalog for Road to Vostok 0.1.1.3, including Chewing Gum.

## 0.2.1

- Fixed a bug where saves containing data from mods could get corrupted when saved.

## 0.2.0

- Initial public release.
