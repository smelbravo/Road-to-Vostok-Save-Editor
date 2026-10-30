# Changelog

## 0.5.0

### Highlights

- **Save slot mods**: works with both **Save Slots** (by Joni, also bundled in RTV Mod Manager) and **Multi Save Slots Reborn**. Pick the slot to edit in Settings. Edits to the slot that is active in the game also update that slot's stored copy; other slots are edited in their own folder.
- **Mod profiles**: reads the active **Metro Mod Loader** profile (`mod_config.cfg`) and **RTV Mod Manager** profiles. Mods switched off in the active profile are marked, and Gear Storage Expansion's MCM settings are read from the active profile's file (`config.ini` for Default, `<profile>.ini` otherwise).
- **RTV Mod Manager**: mods in `mods/Library` are found too.
- **Items from the game files**: the editor now reads item resources from `RTV.pck`, so items added by game updates show up without a new editor release. The reader is checked against the built-in catalog at startup; if it does not agree, only names derived from the file paths are used. Modded items from `.vmz` archives keep working as before.

- **Mod Settings tab**: reads and edits the settings Mod Configuration Menu (MCM) saved for every mod (`user://MCM/<mod>/<profile>.ini`): toggles, numbers within their ranges, text, dropdowns, colors and vectors, grouped by category like the in-game menu, for the active profile or any other. Only the changed value is rewritten and the previous file is kept as `.ini.editor-backup`.
- **Shelter tab**: shows what each shelter (Cabin, Attic, Classroom, Tent, Bunker) stores: every container with its items, the items lying around, with search. Read only.
- **World**: time of day can be set; the Garage shelter can be unlocked and teleported to.
- **Shelter edit mode**: change condition and quantity, remove items and add items to any container, then Save edits (the save is backed up first). Loose items are still read only.
- **Mod Settings tabs** (as in MCM Reskin & Tabs): each mod's settings are split into one tab per category, the mod's "Enable"/"Active" switch sits above the tabs, and a search box filters the options of the mod.
- **Mod Settings**: pick the profile (the active one by default); only mods that have settings for that profile, and are not switched off in the active one, are listed.
- **Gear Storage**: a chevron on stored weapons (gun slots) opens a weapon picker, like the equipment slots, with "None" to empty the slot.
- **Backups**: each backup has a Delete button and there is a Delete all button (both ask for a second click to confirm).

### Fixes

- Modded weapon scenes (SVT-40, ...) that drop a built-in scope in without a scale now draw it at the built-in 0.5 instead of twice that size; suppressors a scene does not place are drawn at the end of the barrel, past the weapon's art (measured against the in-game SVT-40), instead of over the muzzle.
- Gear Storage no longer lists the equipped weapons as containers (their attachments are edited in the inventory / Edit Loadout).
- Only mods the active profile loads add items: switched-off copies and extra versions of the same mod (e.g. NARK's Gunworks v0.1.3/v1.3/v1.4 in the RTV Mod Manager library) no longer count.
- Bipod attachments (G28) get their own slot in the weapon workbench.
- Modded weapon scenes that place vanilla attachments (ACOG, suppressors, ...) with their own position and scale are now followed, instead of using the base weapon's layout, which drew them too small or in the wrong place.
- Shelter tab shows every shelter file in the save, including ones added by game updates (Garage).
- Modded icons no longer overwrite each other: mods that name every icon `Icon.res` (NARK firearms and melee) now show the right icon per item (M45A1, Beretta 92FS, knives).
- Equipped attachments the weapon layout does not list (e.g. a vanilla suppressor or scope on a modded rifle) always get a slot in Edit Loadout and are drawn where the weapon's other attachments of that kind go.
- Edit Loadout slot buttons on the same edge no longer overlap.
- Icons are also found when the file name only contains the item name (`Icon_G28_Scope.png` for `G28_Scope`).
- Gear Storage no longer lists weapons lying in the inventory.
- Gear Storage: items are dragged like in the inventory (ghost under the cursor, green or red drop spot) and R turns the item you hold, or the selected one.
- G28-style attachment layers are drawn at their texture size and offset instead of being stretched over the whole weapon (the suppressor sat in the wrong place).
- Modded attachment icons are drawn at the size their own texture gives (they were tiny when the mod texture is larger than the inventory icon), and accepted optics, muzzle devices and lasers a weapon scene does not place are drawn at an approximate position instead of not at all.
- Mods that store items as binary `.res` files are read too, `.tres` files up to 2 MB are accepted, and Settings shows how many items each mod added and which resource files were skipped.
- Rescan in Settings now applies right away (updated icons and weapon layouts of mod items already loaded) and shows "Scanning…" while it runs.

- Icons stored as compressed `.res` textures (zstd, used by NARK's Karambit and others) and as portable textures with a lossless WebP/PNG inside (Green Swamp ghillie items) are now read.
- G28-style weapons: attachments that are drawn as full-size layers over the weapon icon (scope, suppressor, bipod, camo) are shown on the icon and offered in the workbench, even when the weapon's `compatible` list only names the vanilla ones. Attachments can also claim a weapon from their own `compatible` list.

- Modded weapons: attachments the mod lists as compatible are always selectable in the workbench and in the right-click menu, even when the weapon's scene gives them no position; attachment sprites use the mod's own texture, so magazines and optics look like they do in game. Camo-type attachments get their own slot.
- Gear Storage: right-click an item for Edit Loadout / Edit Armor, Remove attachment, Move to inventory and Delete, like in the inventory.
- Icons: compressed (RSCC) and DXT1 `.res` textures are read; the icon diagnostics in Settings now show the real reason and the icon path.

- Modded weapons now show their equipped attachments on the icon (inventory, equipment and Gear Storage) and can be edited in the weapon workbench: the editor reads each weapon's `compatible` list and inventory scene from the mod.
- Gear Storage draws weapons with their attachments like the inventory does.

- Fixed the black Quests/Character/... tabs and the freezes when switching pages; save tabs now show the load error instead of an empty screen.
- Mod, game-item and task scans are cached (Rescan in Settings forces a refresh) and zips are read as streams, so large mods no longer lag the app.
- More modded item icons: binary `.res` textures and icons stored in a different folder inside the mod archive are now found.
- New "Modded" filter in Add Item; Gear Storage's add dialog now has category and Modded filters.

- Icons of modded items now show up: the editor reads the icon each mod item points at (png/jpg, or an imported `.ctex`) from the mod archive.
- Icons of vanilla items whose texture changed in Build 2 (e.g. some knives) are resolved from the game files instead of the built-in file names.
- Gear Storage: slots grow to fit the item inside them, so rifles and pistols no longer overlap neighbouring slots.
- Gear Storage: slot names are no longer cut off, and stored weapons and plated rigs have **Edit loadout** / **Edit armor** like the inventory (weapons whose attachment options the editor does not know, such as mod guns, still cannot be edited).
- Game files: paths inside `RTV.pck` are normalised (with or without `res://`) so the item scan finds the item resources; when it finds none, Settings shows how many files the archive has and sample paths.
- Settings: profile and game-file diagnostics are shown above the (long) mod list.

- Gear Storage: items can be dragged between slots and grid cells (in the same bag or another one).
- Modded item icons: textures imported as lossless/WebP/VRAM-compressed `.ctex` are read, and Settings lists the modded items that still have no icon, grouped by reason.
- Quests: tasks are read from the game files (so tasks and traders added in Build 2 show up) and the Driver and Hunter traders are supported. Settings shows how many tasks were found and which properties they have.

### Other

- Backups are kept per slot (`slotN_` prefix) and restoring only offers backups of the slot being edited.
- Added `scripts/test-slots-profiles.ts`.
- Known limits: the binary resource reader and the Mod Manager `profile.json` reader were written from the engine/mod sources and synthetic samples, not from real Build 2 files.

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
