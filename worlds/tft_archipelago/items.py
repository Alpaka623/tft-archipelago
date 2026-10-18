from dataclasses import dataclass
from typing import Dict, List

from BaseClasses import ItemClassification


BASE_ITEM_ID = 7430000


@dataclass(frozen=True)
class TFTItemData:
    code: int
    classification: ItemClassification
    max_quantity: int


ITEM_TABLE: Dict[str, TFTItemData] = {
    "Progressive Reroll": TFTItemData(BASE_ITEM_ID + 0, ItemClassification.progression, 10),
    "Progressive Augment Reroll": TFTItemData(BASE_ITEM_ID + 1, ItemClassification.progression, 9),
    "Progressive XP Buy": TFTItemData(BASE_ITEM_ID + 2, ItemClassification.progression, 10),
    "Augment Slot Left": TFTItemData(BASE_ITEM_ID + 3, ItemClassification.progression, 1),
    "Augment Slot Right": TFTItemData(BASE_ITEM_ID + 4, ItemClassification.progression, 1),
    "Shop Slot 4 Unlock": TFTItemData(BASE_ITEM_ID + 5, ItemClassification.progression, 1),
    "Shop Slot 5 Unlock": TFTItemData(BASE_ITEM_ID + 6, ItemClassification.progression, 1),
    "Progressive Major Check Unlock": TFTItemData(BASE_ITEM_ID + 7, ItemClassification.progression, 0),
    "Nothing": TFTItemData(BASE_ITEM_ID + 8, ItemClassification.filler, 0),
    # One-time items: each allows one action beyond the current limit, then it is used up
    "Bonus Reroll": TFTItemData(BASE_ITEM_ID + 9, ItemClassification.filler, 0),
    "Bonus XP Buy": TFTItemData(BASE_ITEM_ID + 10, ItemClassification.filler, 0),
    "Bonus Augment Reroll": TFTItemData(BASE_ITEM_ID + 11, ItemClassification.filler, 0),
    "Free Augment Pick": TFTItemData(BASE_ITEM_ID + 12, ItemClassification.filler, 0),
    "Shop Slot Pass": TFTItemData(BASE_ITEM_ID + 13, ItemClassification.filler, 0),
    # Traps (optional): a short extra restriction
    "Reroll Lock Trap": TFTItemData(BASE_ITEM_ID + 14, ItemClassification.trap, 0),
    "XP Lock Trap": TFTItemData(BASE_ITEM_ID + 15, ItemClassification.trap, 0),
    "Augment Lock Trap": TFTItemData(BASE_ITEM_ID + 16, ItemClassification.trap, 0),
    "Shop Lock Trap": TFTItemData(BASE_ITEM_ID + 17, ItemClassification.trap, 0),
}


# Relative weights for the free locations; strong one-time items are rarer
BONUS_ITEM_WEIGHTS: Dict[str, int] = {
    "Bonus Reroll": 35,
    "Bonus XP Buy": 30,
    "Bonus Augment Reroll": 15,
    "Free Augment Pick": 10,
    "Shop Slot Pass": 10,
}

TRAP_ITEM_WEIGHTS: Dict[str, int] = {
    "Reroll Lock Trap": 1,
    "XP Lock Trap": 1,
    "Augment Lock Trap": 1,
    "Shop Lock Trap": 1,
}


ITEM_NAME_TO_ID: Dict[str, int] = {
    item_name: item_data.code
    for item_name, item_data in ITEM_TABLE.items()
}


def build_full_item_pool(major_check_unlock_count: int = 0) -> List[str]:
    item_pool: List[str] = []

    for item_name, item_data in ITEM_TABLE.items():
        if item_data.max_quantity <= 0:
            continue
        item_pool.extend([item_name] * item_data.max_quantity)

    item_pool.extend(["Progressive Major Check Unlock"] * max(0, major_check_unlock_count))

    return item_pool
