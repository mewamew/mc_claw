const FOOD_PRIORITY = [
  // Best cooked foods first
  'golden_apple',
  'enchanted_golden_apple',
  'cooked_beef',
  'cooked_porkchop',
  'cooked_mutton',
  'cooked_salmon',
  'cooked_chicken',
  'cooked_cod',
  'baked_potato',
  'bread',
  'cooked_rabbit',
  'golden_carrot',
  'sweet_berries',
  'apple',
  'melon_slice',
  'dried_kelp',
  'cookie',
  'beetroot',
  'carrot',
  'potato',
  'pumpkin_pie',
  'mushroom_stew',
  'rabbit_stew',
  'beetroot_soup',
  'suspicious_stew',
  // Raw foods (edible but less effective, for emergencies)
  'beef',
  'porkchop',
  'mutton',
  'chicken',
  'rabbit',
  'cod',
  'salmon',
  // Desperate options
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
];

const FOOD_SET = new Set(FOOD_PRIORITY);

function createHandleEat({ getBot }) {
  return async function handleEat(payload) {
    const bot = getBot();
    const inventory = bot.inventory.items();
    let foodItem;

  if (payload && payload.itemName) {
    // Validate the item is actually food
    if (!FOOD_SET.has(payload.itemName)) {
      const foodInBag = inventory.filter((i) => FOOD_SET.has(i.name)).map((i) => `${i.name}x${i.count}`).join(', ');
      throw new Error(`${payload.itemName} 不是食物，无法食用。可食用的物品: ${foodInBag || '背包中没有任何食物。建议: 用 attack 杀动物获取生肉，再用 smelt 烹饪成熟肉；或用 findAndCollect 采集苹果(apple)、甜浆果(sweet_berries)等'}`);
    }
    // Find the specified food in inventory
    foodItem = inventory.find((i) => i.name === payload.itemName);
    if (!foodItem) {
      const inv = inventory.map((i) => `${i.name}x${i.count}`).join(', ') || '(empty)';
      throw new Error(`No ${payload.itemName} in inventory. Current inventory: ${inv}`);
    }
  } else {
    // Auto-pick best food from inventory by priority order
    for (const foodName of FOOD_PRIORITY) {
      foodItem = inventory.find((i) => i.name === foodName);
      if (foodItem) break;
    }

    if (!foodItem) {
      // Also try any food-like item not in our priority list (modded items, etc.)
      // by checking if mcData recognizes it as food
      const mcData = require('minecraft-data')(bot.version);
      foodItem = inventory.find((i) => {
        const itemData = mcData.itemsByName[i.name];
        return itemData && FOOD_SET.has(i.name);
      });
    }

    if (!foodItem) {
      const inv = inventory.map((i) => `${i.name}x${i.count}`).join(', ') || '(empty)';
      throw new Error(`背包中没有任何食物。当前背包: ${inv}。建议: 用 lookAround 寻找动物(cow/pig/chicken/sheep)，用 attack 杀死获取生肉，再用 smelt 烹饪; 或用 findAndCollect 采集 sweet_berries/apple`);
    }
  }

    const fullHunger = bot.food === 20;

  // Equip the food to hand
    await bot.equip(foodItem, 'hand');

  // Eat the food
    await bot.consume();

    return {
      action: 'eat',
      item: foodItem.name,
      health: bot.health,
      food: bot.food,
      saturation: bot.foodSaturation,
      fullHungerBeforeEating: fullHunger,
    };
  };
}

module.exports = createHandleEat;
