-- DataStore 저장/불러오기
local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage.Shared.Config)

local store = DataStoreService:GetDataStore(Config.DataStoreName)

local PlayerData = {}

local pendingSaves = 0

local function defaultData()
	return {
		Coins = 0,
		Levels = { ClickPower = 0, AutoIncome = 0, Multiplier = 0 },
	}
end

-- 저장된 데이터에 빠진 필드가 있어도 안전하게 기본값으로 채운다.
local function reconcile(saved)
	local data = defaultData()
	if type(saved) ~= "table" then
		return data
	end
	if type(saved.Coins) == "number" then
		data.Coins = saved.Coins
	end
	if type(saved.Levels) == "table" then
		for id in data.Levels do
			if type(saved.Levels[id]) == "number" then
				data.Levels[id] = saved.Levels[id]
			end
		end
	end
	return data
end

local function keyFor(player: Player)
	return "Player_" .. player.UserId
end

-- 반환: data, canSave
-- 불러오기에 실패하면 임시 데이터로 플레이하게 하되 저장은 막는다(기존 데이터 덮어쓰기 방지).
function PlayerData.load(player: Player)
	for attempt = 1, 3 do
		local ok, result = pcall(store.GetAsync, store, keyFor(player))
		if ok then
			return reconcile(result), true
		end
		warn(`[PlayerData] 불러오기 실패 ({attempt}/3): {result}`)
		-- Studio에서 API 접근이 막혀 있으면 재시도해도 소용없으니 바로 포기한다
		if RunService:IsStudio() then
			break
		end
		task.wait(2)
	end
	warn("[PlayerData] 저장 없이 임시 데이터로 진행합니다.")
	return defaultData(), false
end

function PlayerData.save(player: Player, data, canSave: boolean)
	if not canSave then
		return
	end
	pendingSaves += 1
	local ok, err = pcall(store.SetAsync, store, keyFor(player), data)
	if not ok then
		warn(`[PlayerData] 저장 실패: {err}`)
	end
	pendingSaves -= 1
end

-- 서버 종료 시 진행 중인 저장이 끝날 때까지 기다린다.
function PlayerData.waitForSaves()
	while pendingSaves > 0 do
		task.wait()
	end
end

return PlayerData
