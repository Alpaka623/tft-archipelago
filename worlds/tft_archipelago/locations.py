from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional, Union

from .location_catalog import LOCATION_CATALOG


BASE_LOCATION_ID = 7431000
LocationCategory = Literal["major", "minor"]


@dataclass(frozen=True)
class ChampionCondition:
    type: Literal["champion"]
    champion_id: str
    minimum_star_level: Optional[int] = None
    requires_player_combat: bool = False


@dataclass(frozen=True)
class TraitCondition:
    type: Literal["trait"]
    trait: str
    minimum_active: int


@dataclass(frozen=True)
class ActiveTraitCountCondition:
    type: Literal["activeTraitCount"]
    minimum_active_traits: int
    requires_player_combat: bool = False


@dataclass(frozen=True)
class GoldCondition:
    type: Literal["gold"]
    minimum_gold: int


@dataclass(frozen=True)
class LevelCondition:
    type: Literal["level"]
    minimum_level: int


@dataclass(frozen=True)
class StageCondition:
    type: Literal["stage"]
    minimum_stage: int


LocationCondition = Union[
    ChampionCondition,
    TraitCondition,
    ActiveTraitCountCondition,
    GoldCondition,
    LevelCondition,
    StageCondition,
]


@dataclass(frozen=True)
class TFTLocationData:
    code: int
    category: LocationCategory
    condition: LocationCondition
    # Rarely achievable (3-star 4-/5-costs): only filler and traps, never progression
    filler_only: bool = False


def build_condition(raw: Dict[str, Any]) -> LocationCondition:
    condition_type = raw["type"]
    if condition_type == "champion":
        return ChampionCondition(
            "champion",
            raw["championId"],
            raw.get("minimumStarLevel"),
            bool(raw.get("requiresPlayerCombat", False)),
        )
    if condition_type == "trait":
        return TraitCondition("trait", raw["trait"], raw["minimumActive"])
    if condition_type == "activeTraitCount":
        return ActiveTraitCountCondition(
            "activeTraitCount",
            raw["minimumActiveTraits"],
            bool(raw.get("requiresPlayerCombat", False)),
        )
    if condition_type == "gold":
        return GoldCondition("gold", raw["minimumGold"])
    if condition_type == "level":
        return LevelCondition("level", raw["minimumLevel"])
    if condition_type == "stage":
        return StageCondition("stage", raw["minimumStage"])
    raise ValueError(f"Unknown location condition type: {condition_type}")


# Generated catalog (scripts/generate-locations.mjs); the app reads the same data
LOCATION_TABLE: Dict[str, TFTLocationData] = {
    entry["name"]: TFTLocationData(
        entry["id"],
        entry["category"],
        build_condition(entry["condition"]),
        bool(entry.get("fillerOnly", False)),
    )
    for entry in LOCATION_CATALOG
}


MAJOR_LOCATION_TABLE: Dict[str, TFTLocationData] = {
    location_name: location_data
    for location_name, location_data in LOCATION_TABLE.items()
    if location_data.category == "major"
}


MINOR_LOCATION_TABLE: Dict[str, TFTLocationData] = {
    location_name: location_data
    for location_name, location_data in LOCATION_TABLE.items()
    if location_data.category == "minor"
}


LOCATION_NAME_TO_ID: Dict[str, int] = {
    location_name: location_data.code
    for location_name, location_data in LOCATION_TABLE.items()
}
