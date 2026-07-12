-- 添加属性克制系统和逃跑限制
-- 执行时间: 2026-07-02

-- 1. 给user_pets表添加属性字段
ALTER TABLE user_pets ADD COLUMN element VARCHAR(20) DEFAULT 'normal';

-- 2. 更新现有宠物的属性
UPDATE user_pets SET element = 'electric' WHERE species IN ('pikachu', 'raichu');
UPDATE user_pets SET element = 'normal' WHERE species = 'eevee';
UPDATE user_pets SET element = 'grass' WHERE species IN ('bulbasaur', 'ivysaur', 'venusaur');
UPDATE user_pets SET element = 'fire' WHERE species IN ('charmander', 'charmeleon', 'charizard');
UPDATE user_pets SET element = 'water' WHERE species IN ('squirtle', 'wartortle', 'blastoise');

-- 3. 给pet_battles表添加逃跑次数字段
ALTER TABLE pet_battles ADD COLUMN challenger_escape_count INTEGER DEFAULT 0;
ALTER TABLE pet_battles ADD COLUMN opponent_escape_count INTEGER DEFAULT 0;

-- 4. 添加属性克制记录字段（用于战斗日志）
ALTER TABLE pet_battles ADD COLUMN type_effectiveness_log TEXT;

-- 5. 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_user_pets_element ON user_pets(element);
