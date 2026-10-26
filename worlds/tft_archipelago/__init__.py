from typing import Any, Dict, List

from BaseClasses import Item, Location, LocationProgressType, Region, Tutorial
from Options import OptionGroup
from worlds.AutoWorld import WebWorld, World

from .items import BONUS_ITEM_WEIGHTS, ITEM_NAME_TO_ID, ITEM_TABLE, TRAP_ITEM_WEIGHTS, build_full_item_pool
from .locations import LOCATION_NAME_TO_ID, LOCATION_TABLE, MAJOR_LOCATION_TABLE
from .options import BonusItemShare, GoalChecks, StartingMajorChecks, TFTArchipelagoOptions, TrapShare
from .rules import set_rules


class TFTArchipelagoWebWorld(WebWorld):
    theme = "grass"
    bug_report_page = "https://github.com/Alpaka623/tft-archipelago-releases/issues"
    tutorials = [
        Tutorial(
            "Multiworld Setup Guide",
            "A guide to setting up the TFT Archipelago app and joining a multiworld.",
            "English",
            "setup_en.md",
            "setup/en",
            ["Novy"],
        )
    ]
    option_groups = [
        OptionGroup("Goal", [GoalChecks, StartingMajorChecks]),
        OptionGroup("Item Pool", [BonusItemShare, TrapShare]),
    ]


class TFTArchipelagoItem(Item):
    game = "TFT Archipelago"


class TFTArchipelagoLocation(Location):
    game = "TFT Archipelago"


class TFTArchipelagoWorld(World):
    """Archipelago world definition for the TFT Archipelago overlay client."""

    game = "TFT Archipelago"
    author: str = "Novy"
    web = TFTArchipelagoWebWorld()
    options_dataclass = TFTArchipelagoOptions
    options: TFTArchipelagoOptions

    item_name_to_id = ITEM_NAME_TO_ID
    location_name_to_id = LOCATION_NAME_TO_ID
    starting_major_location_names: List[str]
    major_unlock_order_location_names: List[str]

    def generate_early(self) -> None:
        major_location_names = list(MAJOR_LOCATION_TABLE)
        starting_count = min(int(self.options.starting_major_checks.value), len(major_location_names))

        self.starting_major_location_names = self.random.sample(major_location_names, starting_count)
        self.major_unlock_order_location_names = [
            location_name
            for location_name in major_location_names
            if location_name not in self.starting_major_location_names
        ]
        self.random.shuffle(self.major_unlock_order_location_names)

    def get_starting_major_location_names(self) -> List[str]:
        if not hasattr(self, "starting_major_location_names"):
            self.generate_early()
        return self.starting_major_location_names

    def get_major_unlock_order_location_names(self) -> List[str]:
        if not hasattr(self, "major_unlock_order_location_names"):
            self.generate_early()
        return self.major_unlock_order_location_names

    def create_item(self, name: str) -> TFTArchipelagoItem:
        item_data = ITEM_TABLE[name]
        return TFTArchipelagoItem(name, item_data.classification, item_data.code, self.player)

    def create_items(self) -> None:
        location_count = len(LOCATION_TABLE)
        required_major_unlocks = [
            "Progressive Major Check Unlock"
            for _ in self.get_major_unlock_order_location_names()
        ]
        item_names = build_full_item_pool()
        self.random.shuffle(item_names)
        item_names = required_major_unlocks + item_names[:max(0, location_count - len(required_major_unlocks))]
        self.random.shuffle(item_names)

        item_names = item_names[:location_count]
        # Free locations get one-time items, traps or Nothing by the configured shares
        item_names.extend(self.get_filler_item_name() for _ in range(location_count - len(item_names)))

        self.multiworld.itempool.extend(self.create_item(item_name) for item_name in item_names)

    def create_regions(self) -> None:
        menu_region = Region("Menu", self.player, self.multiworld)
        checks_region = Region("TFT Checks", self.player, self.multiworld)

        checks_region.locations = [
            TFTArchipelagoLocation(self.player, location_name, location_data.code, checks_region)
            for location_name, location_data in LOCATION_TABLE.items()
        ]
        # Rarely achievable checks hold optional rewards only, never something the run depends on
        for location in checks_region.locations:
            if LOCATION_TABLE[location.name].filler_only:
                location.progress_type = LocationProgressType.EXCLUDED

        menu_region.connect(checks_region)
        self.multiworld.regions.extend([menu_region, checks_region])

    def set_rules(self) -> None:
        set_rules(
            self.multiworld,
            self.player,
            int(self.options.goal_checks.value),
            self.get_starting_major_location_names(),
            self.get_major_unlock_order_location_names(),
        )

    def fill_slot_data(self) -> Dict[str, Any]:
        return {
            "goal_checks": int(self.options.goal_checks.value),
            "starting_major_checks": int(self.options.starting_major_checks.value),
            "bonus_item_share": int(self.options.bonus_item_share.value),
            "trap_share": int(self.options.trap_share.value),
            "trust_mode": bool(self.options.trust_mode.value),
            "starting_major_location_ids": [
                LOCATION_TABLE[location_name].code
                for location_name in self.get_starting_major_location_names()
            ],
            "major_unlock_order_location_ids": [
                LOCATION_TABLE[location_name].code
                for location_name in self.get_major_unlock_order_location_names()
            ],
        }

    # Also used by core for start_inventory_from_pool gaps
    def get_filler_item_name(self) -> str:
        roll = self.random.random() * 100
        trap_share = int(self.options.trap_share.value)
        if roll < trap_share:
            return self.random.choices(list(TRAP_ITEM_WEIGHTS), weights=list(TRAP_ITEM_WEIGHTS.values()))[0]
        if roll < trap_share + (100 - trap_share) * int(self.options.bonus_item_share.value) / 100:
            return self.random.choices(list(BONUS_ITEM_WEIGHTS), weights=list(BONUS_ITEM_WEIGHTS.values()))[0]
        return "Nothing"
