from typing import TYPE_CHECKING

from .locations import LOCATION_TABLE, MAJOR_LOCATION_TABLE

if TYPE_CHECKING:
    from BaseClasses import CollectionState, MultiWorld


MAJOR_CHECK_UNLOCK_ITEM_NAME = "Progressive Major Check Unlock"


def count_reachable_checks(state: "CollectionState", player: int) -> int:
    return sum(
        1
        for location_name in MAJOR_LOCATION_TABLE
        if state.can_reach_location(location_name, player)
    )


def set_rules(
    multiworld: "MultiWorld",
    player: int,
    goal_checks: int,
    starting_major_location_names: list[str],
    major_unlock_order_location_names: list[str],
) -> None:
    starting_major_locations = set(starting_major_location_names)
    locked_major_unlock_counts = {
        location_name: index + 1
        for index, location_name in enumerate(major_unlock_order_location_names)
    }

    for location_name in LOCATION_TABLE:
        location = multiworld.get_location(location_name, player)
        if location_name in MAJOR_LOCATION_TABLE and location_name not in starting_major_locations:
            required_unlocks = locked_major_unlock_counts[location_name]
            location.access_rule = (
                lambda state, required_unlocks=required_unlocks: state.has(
                    MAJOR_CHECK_UNLOCK_ITEM_NAME,
                    player,
                    required_unlocks,
                )
            )
        else:
            location.access_rule = lambda state: True

    multiworld.completion_condition[player] = (
        lambda state: count_reachable_checks(state, player) >= goal_checks
    )
