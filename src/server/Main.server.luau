local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local Formulas = require(ReplicatedStorage.Shared.Formulas)
local PlayerData = require(script.Parent.PlayerData)

-- 클라이언트와 통신하는 RemoteEvent들
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
remotes.Parent = ReplicatedStorage

local function makeRemote(name: string): RemoteEvent
	local remote = Instance.new("RemoteEvent")
	remote.Name = name
	remote.Parent = remotes
	return remote
end

local Ready = makeRemote("Ready") -- 클라이언트 → 서버: UI 준비됨
local Click = makeRemote("Click") -- 클라이언트 → 서버: 클릭
local BuyUpgrade = makeRemote("BuyUpgrade") -- 클라이언트 → 서버: 업그레이드 구매
local StateUpdate = makeRemote("StateUpdate") -- 서버 → 클라이언트: 현재 상태

-- 접속 중인 플레이어의 세션 (서버가 유일한 진실의 원천)
local sessions = {}

local function pushState(player: Player)
	local s = sessions[player]
	if not s then
		return
	end
	StateUpdate:FireClient(player, {
		Coins = s.data.Coins,
		Levels = s.data.Levels,
		HasGamepass = s.hasGamepass,
	})
end

local function addCoins(player: Player, amount: number)
	local s = sessions[player]
	if not s then
		return
	end
	s.data.Coins += amount
	s.coinsValue.Value = math.floor(math.min(s.data.Coins, 9e15))
end

local function onPlayerAdded(player: Player)
	local data, canSave = PlayerData.load(player)
	if not player.Parent then
		return -- 불러오는 동안 나가버림
	end

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	local coinsValue = Instance.new("IntValue")
	coinsValue.Name = "Coins"
	coinsValue.Parent = leaderstats
	leaderstats.Parent = player

	local hasGamepass = false
	if Config.Gamepass2xId ~= 0 then
		local ok, owns = pcall(
			MarketplaceService.UserOwnsGamePassAsync,
			MarketplaceService,
			player.UserId,
			Config.Gamepass2xId
		)
		hasGamepass = ok and owns
	end

	sessions[player] = {
		data = data,
		canSave = canSave,
		hasGamepass = hasGamepass,
		coinsValue = coinsValue,
		windowStart = 0,
		clicks = 0,
	}
	addCoins(player, 0) -- leaderstats 값 동기화
	pushState(player)
end

local function onPlayerRemoving(player: Player)
	local s = sessions[player]
	if not s then
		return
	end
	sessions[player] = nil
	PlayerData.save(player, s.data, s.canSave)
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Ready.OnServerEvent:Connect(pushState)

Click.OnServerEvent:Connect(function(player)
	local s = sessions[player]
	if not s then
		return
	end

	-- 초당 클릭 수 제한
	local now = os.clock()
	if now - s.windowStart >= 1 then
		s.windowStart = now
		s.clicks = 0
	end
	s.clicks += 1
	if s.clicks > Config.MaxClicksPerSecond then
		return
	end

	addCoins(player, Formulas.clickValue(s.data.Levels, s.hasGamepass))
	pushState(player)
end)

BuyUpgrade.OnServerEvent:Connect(function(player, id)
	if typeof(id) ~= "string" then
		return
	end
	local def = Config.Upgrades[id]
	local s = sessions[player]
	if not def or not s then
		return
	end

	local level = s.data.Levels[id] or 0
	local cost = Formulas.upgradeCost(id, level)
	if s.data.Coins < cost then
		return
	end

	addCoins(player, -cost)
	s.data.Levels[id] = level + 1
	pushState(player)
end)

-- 게임패스 구매 완료
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gamePassId, wasPurchased)
	if wasPurchased and gamePassId == Config.Gamepass2xId then
		local s = sessions[player]
		if s then
			s.hasGamepass = true
			pushState(player)
		end
	end
end)

-- 1초마다 자동 수입
task.spawn(function()
	while true do
		task.wait(1)
		for player, s in sessions do
			local perSecond = Formulas.perSecond(s.data.Levels, s.hasGamepass)
			if perSecond > 0 then
				addCoins(player, perSecond)
				pushState(player)
			end
		end
	end
end)

-- 자동 저장
task.spawn(function()
	while true do
		task.wait(Config.AutoSaveSeconds)
		for player, s in sessions do
			task.spawn(PlayerData.save, player, s.data, s.canSave)
		end
	end
end)

-- 서버 종료 시 남은 플레이어 저장
game:BindToClose(function()
	for player, s in sessions do
		sessions[player] = nil
		task.spawn(PlayerData.save, player, s.data, s.canSave)
	end
	PlayerData.waitForSaves()
end)

print(`[Server] {Config.GameName} 시작`)
