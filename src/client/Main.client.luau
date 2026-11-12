local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Formulas = require(Shared:WaitForChild("Formulas"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local Ready = remotes:WaitForChild("Ready")
local Click = remotes:WaitForChild("Click")
local BuyUpgrade = remotes:WaitForChild("BuyUpgrade")
local StateUpdate = remotes:WaitForChild("StateUpdate")

-- 서버가 보내주는 현재 상태 (화면 표시용)
local state = {
	Coins = 0,
	Levels = { ClickPower = 0, AutoIncome = 0, Multiplier = 0 },
	HasGamepass = false,
}

local COLOR_PANEL = Color3.fromRGB(28, 30, 38)
local COLOR_AFFORD = Color3.fromRGB(60, 160, 90)
local COLOR_LOCKED = Color3.fromRGB(70, 72, 82)
local COLOR_GOLD = Color3.fromRGB(255, 200, 60)

-- 작은 헬퍼: 인스턴스를 속성과 함께 만든다
local function create(className: string, props, children)
	local inst = Instance.new(className)
	for key, value in props do
		if key ~= "Parent" then
			inst[key] = value
		end
	end
	for _, child in children or {} do
		child.Parent = inst
	end
	inst.Parent = props.Parent
	return inst
end

local function corner(radius: number)
	return create("UICorner", { CornerRadius = UDim.new(0, radius) })
end

---------------------------------------------------------------------
-- UI 만들기
---------------------------------------------------------------------
local gui = create("ScreenGui", {
	Name = "ClickerGui",
	ResetOnSpawn = false,
	IgnoreGuiInset = true,
	Parent = playerGui,
})

-- 상단: 코인 / 수입 정보
local coinsLabel = create("TextLabel", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 24),
	Size = UDim2.fromOffset(360, 56),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 44,
	TextColor3 = COLOR_GOLD,
	Text = "🪙 0",
	Parent = gui,
})

local infoLabel = create("TextLabel", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 80),
	Size = UDim2.fromOffset(360, 24),
	BackgroundTransparency = 1,
	Font = Enum.Font.Gotham,
	TextSize = 18,
	TextColor3 = Color3.fromRGB(230, 230, 230),
	Text = "",
	Parent = gui,
})

-- 가운데: 큰 클릭 버튼
local clickButton = create("TextButton", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.38, 0.5),
	Size = UDim2.fromOffset(220, 220),
	BackgroundColor3 = COLOR_GOLD,
	AutoButtonColor = false,
	Font = Enum.Font.GothamBold,
	TextSize = 30,
	TextColor3 = Color3.fromRGB(90, 55, 0),
	Text = "CLICK!",
	Parent = gui,
}, {
	corner(110),
	create("UIStroke", { Thickness = 5, Color = Color3.fromRGB(200, 140, 20) }),
})
local clickScale = create("UIScale", { Scale = 1, Parent = clickButton })

-- 오른쪽: 업그레이드 패널
local panel = create("Frame", {
	AnchorPoint = Vector2.new(1, 0.5),
	Position = UDim2.new(1, -20, 0.5, 0),
	Size = UDim2.fromOffset(300, 360),
	BackgroundColor3 = COLOR_PANEL,
	BackgroundTransparency = 0.1,
	Parent = gui,
}, {
	corner(14),
	create("UIPadding", {
		PaddingTop = UDim.new(0, 12),
		PaddingBottom = UDim.new(0, 12),
		PaddingLeft = UDim.new(0, 12),
		PaddingRight = UDim.new(0, 12),
	}),
	create("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
})

create("TextLabel", {
	LayoutOrder = 0,
	Size = UDim2.new(1, 0, 0, 28),
	BackgroundTransparency = 1,
	Font = Enum.Font.GothamBold,
	TextSize = 22,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "업그레이드",
	Parent = panel,
})

local rows = {}
for index, id in Config.UpgradeOrder do
	local def = Config.Upgrades[id]

	local button = create("TextButton", {
		LayoutOrder = index,
		Size = UDim2.new(1, 0, 0, 78),
		BackgroundColor3 = COLOR_LOCKED,
		AutoButtonColor = false,
		Text = "",
		Parent = panel,
	}, { corner(10) })

	local title = create("TextLabel", {
		Position = UDim2.fromOffset(12, 8),
		Size = UDim2.new(1, -24, 0, 22),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 18,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = Color3.new(1, 1, 1),
		Parent = button,
	})
	create("TextLabel", {
		Position = UDim2.fromOffset(12, 32),
		Size = UDim2.new(1, -24, 0, 18),
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 14,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = Color3.fromRGB(215, 215, 215),
		Text = def.Desc,
		Parent = button,
	})
	local cost = create("TextLabel", {
		Position = UDim2.fromOffset(12, 52),
		Size = UDim2.new(1, -24, 0, 18),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 15,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = COLOR_GOLD,
		Parent = button,
	})

	button.Activated:Connect(function()
		BuyUpgrade:FireServer(id)
	end)

	rows[id] = { button = button, title = title, cost = cost }
end

-- 게임패스 판매 버튼 (Config.Gamepass2xId 를 설정했을 때만 보인다)
local gamepassButton = create("TextButton", {
	LayoutOrder = 99,
	Size = UDim2.new(1, 0, 0, 44),
	BackgroundColor3 = Color3.fromRGB(120, 80, 200),
	Font = Enum.Font.GothamBold,
	TextSize = 18,
	TextColor3 = Color3.new(1, 1, 1),
	Text = "⭐ 코인 2배 구매",
	Visible = false,
	Parent = panel,
}, { corner(10) })

gamepassButton.Activated:Connect(function()
	MarketplaceService:PromptGamePassPurchase(player, Config.Gamepass2xId)
end)

---------------------------------------------------------------------
-- 화면 갱신
---------------------------------------------------------------------
local function refresh()
	coinsLabel.Text = "🪙 " .. Formulas.format(state.Coins)
	local perClick = Formulas.clickValue(state.Levels, state.HasGamepass)
	local perSecond = Formulas.perSecond(state.Levels, state.HasGamepass)
	infoLabel.Text = `클릭당 {Formulas.format(perClick)}  ·  초당 {Formulas.format(perSecond)}`

	for id, row in rows do
		local level = state.Levels[id] or 0
		local price = Formulas.upgradeCost(id, level)
		row.title.Text = `{Config.Upgrades[id].Name}  Lv.{level}`
		row.cost.Text = `🪙 {Formulas.format(price)}`
		row.button.BackgroundColor3 = if state.Coins >= price then COLOR_AFFORD else COLOR_LOCKED
	end

	gamepassButton.Visible = Config.Gamepass2xId ~= 0 and not state.HasGamepass
end

StateUpdate.OnClientEvent:Connect(function(newState)
	state = newState
	refresh()
end)

---------------------------------------------------------------------
-- 클릭 연출
---------------------------------------------------------------------
local function floatingText(text: string)
	local center = clickButton.AbsolutePosition + clickButton.AbsoluteSize / 2
	local offsetX = math.random(-70, 70)
	local label = create("TextLabel", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromOffset(center.X + offsetX, center.Y - 40),
		Size = UDim2.fromOffset(120, 30),
		BackgroundTransparency = 1,
		Font = Enum.Font.GothamBold,
		TextSize = 26,
		TextColor3 = COLOR_GOLD,
		TextStrokeTransparency = 0.4,
		Text = text,
		Parent = gui,
	})
	local tween = TweenService:Create(label, TweenInfo.new(0.7, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Position = UDim2.fromOffset(center.X + offsetX, center.Y - 130),
		TextTransparency = 1,
		TextStrokeTransparency = 1,
	})
	tween.Completed:Once(function()
		label:Destroy()
	end)
	tween:Play()
end

clickButton.Activated:Connect(function()
	Click:FireServer()

	clickScale.Scale = 0.92
	TweenService:Create(clickScale, TweenInfo.new(0.1), { Scale = 1 }):Play()
	floatingText("+" .. Formulas.format(Formulas.clickValue(state.Levels, state.HasGamepass)))
end)

refresh()
Ready:FireServer() -- 서버에 "UI 준비 완료" 알림 → 현재 상태를 받는다

print(`[Client] {Config.GameName} 접속`)
