export const ITEM_IDS = {
  PROGRESSIVE_REROLL:         7430000,
  PROGRESSIVE_AUGMENT_REROLL: 7430001,
  PROGRESSIVE_XP_BUY:         7430002,
  AUGMENT_SLOT_LEFT:          7430003,
  AUGMENT_SLOT_RIGHT:         7430004,
  SHOP_SLOT_4_UNLOCK:         7430005,
  SHOP_SLOT_5_UNLOCK:         7430006,
  PROGRESSIVE_MAJOR_CHECK_UNLOCK: 7430007,
  NOTHING:                    7430008,
  // One-time items and traps
  BONUS_REROLL:               7430009,
  BONUS_XP_BUY:               7430010,
  BONUS_AUGMENT_REROLL:       7430011,
  FREE_AUGMENT_PICK:          7430012,
  SHOP_SLOT_PASS:             7430013,
  REROLL_LOCK_TRAP:           7430014,
  XP_LOCK_TRAP:               7430015,
  AUGMENT_LOCK_TRAP:          7430016,
  SHOP_LOCK_TRAP:             7430017,
} as const

export type ItemId = typeof ITEM_IDS[keyof typeof ITEM_IDS]

export interface ItemDefinition {
  id: ItemId
  name: string
}

export const ITEM_DEFINITIONS: ItemDefinition[] = [
  { id: ITEM_IDS.PROGRESSIVE_REROLL, name: 'Progressive Reroll' },
  { id: ITEM_IDS.PROGRESSIVE_AUGMENT_REROLL, name: 'Progressive Augment Reroll' },
  { id: ITEM_IDS.PROGRESSIVE_XP_BUY, name: 'Progressive XP Buy' },
  { id: ITEM_IDS.AUGMENT_SLOT_LEFT, name: 'Augment Slot Left' },
  { id: ITEM_IDS.AUGMENT_SLOT_RIGHT, name: 'Augment Slot Right' },
  { id: ITEM_IDS.SHOP_SLOT_4_UNLOCK, name: 'Shop Slot 4 Unlock' },
  { id: ITEM_IDS.SHOP_SLOT_5_UNLOCK, name: 'Shop Slot 5 Unlock' },
  { id: ITEM_IDS.PROGRESSIVE_MAJOR_CHECK_UNLOCK, name: 'Progressive Major Check Unlock' },
  { id: ITEM_IDS.NOTHING, name: 'Nothing' },
  { id: ITEM_IDS.BONUS_REROLL, name: 'Bonus Reroll' },
  { id: ITEM_IDS.BONUS_XP_BUY, name: 'Bonus XP Buy' },
  { id: ITEM_IDS.BONUS_AUGMENT_REROLL, name: 'Bonus Augment Reroll' },
  { id: ITEM_IDS.FREE_AUGMENT_PICK, name: 'Free Augment Pick' },
  { id: ITEM_IDS.SHOP_SLOT_PASS, name: 'Shop Slot Pass' },
  { id: ITEM_IDS.REROLL_LOCK_TRAP, name: 'Reroll Lock Trap' },
  { id: ITEM_IDS.XP_LOCK_TRAP, name: 'XP Lock Trap' },
  { id: ITEM_IDS.AUGMENT_LOCK_TRAP, name: 'Augment Lock Trap' },
  { id: ITEM_IDS.SHOP_LOCK_TRAP, name: 'Shop Lock Trap' },
]
