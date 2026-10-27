from Fill import distribute_items_restrictive

from . import TFTArchipelagoTestBase
from ..items import BONUS_ITEM_WEIGHTS, ITEM_TABLE, TRAP_ITEM_WEIGHTS
from ..locations import LOCATION_TABLE, MAJOR_LOCATION_TABLE
from ..rules import MAJOR_CHECK_UNLOCK_ITEM_NAME

PROGRESSIVE_ITEM_COUNT = sum(item_data.max_quantity for item_data in ITEM_TABLE.values())


def count_pool_items(test: TFTArchipelagoTestBase, item_name: str) -> int:
    return sum(1 for item in test.multiworld.itempool if item.player == test.player and item.name == item_name)


class TestDefaultOptions(TFTArchipelagoTestBase):
    def test_pool_fills_every_location(self) -> None:
        self.assertEqual(len(self.multiworld.itempool), len(LOCATION_TABLE))
        self.assertEqual(len(self.multiworld.get_unfilled_locations(self.player)), len(LOCATION_TABLE))

    def test_pool_holds_every_unlock(self) -> None:
        for item_name, item_data in ITEM_TABLE.items():
            if item_data.max_quantity > 0:
                self.assertEqual(count_pool_items(self, item_name), item_data.max_quantity, item_name)
        locked_majors = len(MAJOR_LOCATION_TABLE) - self.world.options.starting_major_checks.value
        self.assertEqual(count_pool_items(self, MAJOR_CHECK_UNLOCK_ITEM_NAME), locked_majors)

    def test_default_rewards_have_no_nothing_or_traps(self) -> None:
        self.assertEqual(count_pool_items(self, "Nothing"), 0)
        for trap_name in TRAP_ITEM_WEIGHTS:
            self.assertEqual(count_pool_items(self, trap_name), 0, trap_name)

    def test_hard_checks_are_excluded(self) -> None:
        for location_name, location_data in LOCATION_TABLE.items():
            location = self.multiworld.get_location(location_name, self.player)
            self.assertEqual(location.progress_type == location.progress_type.EXCLUDED, location_data.filler_only)

    def test_hard_checks_never_hold_progression(self) -> None:
        distribute_items_restrictive(self.multiworld)
        for location_name, location_data in LOCATION_TABLE.items():
            if location_data.filler_only:
                item = self.multiworld.get_location(location_name, self.player).item
                self.assertFalse(item.advancement, f"{location_name} holds {item.name}")

    def test_slot_data_matches_options(self) -> None:
        slot_data = self.world.fill_slot_data()
        self.assertEqual(slot_data["goal_checks"], self.world.options.goal_checks.value)
        self.assertIs(slot_data["trust_mode"], False)
        starting_ids = slot_data["starting_major_location_ids"]
        unlock_order_ids = slot_data["major_unlock_order_location_ids"]
        self.assertEqual(len(starting_ids), self.world.options.starting_major_checks.value)
        major_ids = {location_data.code for location_data in MAJOR_LOCATION_TABLE.values()}
        self.assertEqual(set(starting_ids) | set(unlock_order_ids), major_ids)
        self.assertFalse(set(starting_ids) & set(unlock_order_ids))


class TestThreeStarProgressionOff(TFTArchipelagoTestBase):
    options = {"three_star_progression": False}

    def test_three_star_checks_are_excluded(self) -> None:
        for location_name, location_data in LOCATION_TABLE.items():
            location = self.multiworld.get_location(location_name, self.player)
            expected = location_data.filler_only or location_data.is_three_star
            self.assertEqual(location.progress_type == location.progress_type.EXCLUDED, expected, location_name)

    def test_three_star_checks_never_hold_progression(self) -> None:
        distribute_items_restrictive(self.multiworld)
        for location_name, location_data in LOCATION_TABLE.items():
            if location_data.is_three_star:
                item = self.multiworld.get_location(location_name, self.player).item
                self.assertFalse(item.advancement, f"{location_name} holds {item.name}")


class TestGoalNeedsUnlocks(TFTArchipelagoTestBase):
    options = {"goal_checks": 20, "starting_major_checks": 11}

    def test_goal_needs_major_check_unlocks(self) -> None:
        self.assertBeatable(False)
        unlocks = self.get_items_by_name(MAJOR_CHECK_UNLOCK_ITEM_NAME)
        self.collect(unlocks[:8])
        self.assertBeatable(False)
        self.collect(unlocks[8:9])
        self.assertBeatable(True)

    def test_locked_majors_open_in_unlock_order(self) -> None:
        order = self.world.get_major_unlock_order_location_names()
        self.assertFalse(self.can_reach_location(order[0]))
        self.collect(self.get_item_by_name(MAJOR_CHECK_UNLOCK_ITEM_NAME))
        self.assertTrue(self.can_reach_location(order[0]))
        self.assertFalse(self.can_reach_location(order[1]))


class TestGoalReachableFromStart(TFTArchipelagoTestBase):
    options = {"goal_checks": 5, "starting_major_checks": 11}

    def test_goal_needs_no_items(self) -> None:
        self.assertBeatable(True)


class TestHardestOptions(TFTArchipelagoTestBase):
    options = {"goal_checks": len(MAJOR_LOCATION_TABLE), "starting_major_checks": 1, "trap_share": 50}

    def test_pool_still_fits(self) -> None:
        self.assertEqual(len(self.multiworld.itempool), len(LOCATION_TABLE))
        self.assertEqual(count_pool_items(self, MAJOR_CHECK_UNLOCK_ITEM_NAME), len(MAJOR_LOCATION_TABLE) - 1)
        self.assertGreater(sum(count_pool_items(self, trap_name) for trap_name in TRAP_ITEM_WEIGHTS), 0)


class TestClassicRewards(TFTArchipelagoTestBase):
    options = {"bonus_item_share": 0, "trap_share": 0}

    def test_free_locations_hold_nothing(self) -> None:
        for bonus_name in BONUS_ITEM_WEIGHTS:
            self.assertEqual(count_pool_items(self, bonus_name), 0, bonus_name)
        locked_majors = len(MAJOR_LOCATION_TABLE) - self.world.options.starting_major_checks.value
        free_locations = len(LOCATION_TABLE) - PROGRESSIVE_ITEM_COUNT - locked_majors
        self.assertEqual(count_pool_items(self, "Nothing"), free_locations)

