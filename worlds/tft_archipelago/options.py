# Options live in a module named "options" so WebHost can unpickle them (Utils.RestrictedUnpickler)
from dataclasses import dataclass

from Options import PerGameCommonOptions, Range, StartInventoryPool

from .locations import MAJOR_LOCATION_TABLE


DEFAULT_STARTING_MAJOR_CHECK_COUNT = 11


class GoalChecks(Range):
    """Number of major checks you have to complete to win. Major checks are the "Reach Top 4 with ..."
    checks: a trait at a high breakpoint or a 5-cost champion on your board at the end of a Top 4 match."""

    display_name = "Goal Checks"
    range_start = 1
    range_end = len(MAJOR_LOCATION_TABLE)
    default = 10


class StartingMajorChecks(Range):
    """Number of major checks you can complete from the start. The others stay locked until you receive
    a Progressive Major Check Unlock; each one opens one more major check."""

    display_name = "Starting Major Checks"
    range_start = 1
    range_end = len(MAJOR_LOCATION_TABLE)
    default = DEFAULT_STARTING_MAJOR_CHECK_COUNT


class BonusItemShare(Range):
    """Percent of the leftover locations (after all unlocks are placed) that hold one-time items such as
    Bonus Reroll instead of Nothing. Each one-time item allows one action beyond your current limit."""

    display_name = "Bonus Item Share"
    range_start = 0
    range_end = 100
    default = 100


class TrapShare(Range):
    """Percent of the leftover locations that hold traps: a short extra restriction such as no shop
    rerolls for a round. Traps replace one-time items or Nothing."""

    display_name = "Trap Share"
    range_start = 0
    range_end = 50
    default = 0


@dataclass
class TFTArchipelagoOptions(PerGameCommonOptions):
    goal_checks: GoalChecks
    starting_major_checks: StartingMajorChecks
    bonus_item_share: BonusItemShare
    trap_share: TrapShare
    # Not part of PerGameCommonOptions: a world has to opt in. Core moves these items from the
    # pool into the start inventory and fills the gaps with get_filler_item_name().
    start_inventory_from_pool: StartInventoryPool
