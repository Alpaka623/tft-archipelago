# Options live in a module named "options" so WebHost can unpickle them (Utils.RestrictedUnpickler)
from dataclasses import dataclass

from Options import DefaultOnToggle, PerGameCommonOptions, Range, StartInventoryPool, Toggle

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


class TrustMode(Toggle):
    """Honor system: the client does not validate your restrictions. Rule violations are not detected
    and never invalidate a match, so checks count whenever you reach Top 4 with the right board.
    Blockers on the shop, XP and augment buttons stay as reminders. Use this if detection does not
    work reliably on your setup (e.g. a non-English client)."""

    display_name = "Trust Mode"


class ThreeStarProgression(DefaultOnToggle):
    """Lets 3-Star checks for 1- to 3-cost champions hold progression items, your own or other games'.
    Turn it off when playing with other games: a specific 3-Star is luck, so these checks then only hold
    one-time items, traps or Nothing. 3-Star checks for 4- and 5-cost champions never hold progression."""

    display_name = "3-Star Progression"


@dataclass
class TFTArchipelagoOptions(PerGameCommonOptions):
    goal_checks: GoalChecks
    starting_major_checks: StartingMajorChecks
    bonus_item_share: BonusItemShare
    trap_share: TrapShare
    trust_mode: TrustMode
    three_star_progression: ThreeStarProgression
    # Not part of PerGameCommonOptions: a world has to opt in. Core moves these items from the
    # pool into the start inventory and fills the gaps with get_filler_item_name().
    start_inventory_from_pool: StartInventoryPool
