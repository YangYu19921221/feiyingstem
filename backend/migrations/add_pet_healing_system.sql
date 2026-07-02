-- 宠物治疗系统 - 数据库升级
-- 为user_pets表增加当前HP和受伤状态

-- 增加当前HP字段（对战实时HP）
ALTER TABLE user_pets ADD COLUMN current_hp INTEGER DEFAULT 120;

-- 增加受伤状态字段
ALTER TABLE user_pets ADD COLUMN is_injured BOOLEAN DEFAULT FALSE;

-- 更新现有宠物的current_hp（根据等级和进化阶段计算）
UPDATE user_pets
SET current_hp = 100 + (level * 5) + (evolution_stage * 20)
WHERE current_hp IS NULL OR current_hp = 120;
