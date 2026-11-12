-- 서버/클라이언트가 같이 쓰는 설정값. 밸런스는 여기서 조절한다.
return {
	GameName = "Coin Clicker",

	DataStoreName = "PlayerData_v1",
	AutoSaveSeconds = 60,
	MaxClicksPerSecond = 20, -- 서버 쪽 매크로/도배 방지

	-- 게임패스 "코인 2배" ID. 0이면 판매 버튼이 숨겨진다.
	-- Creator Hub에서 게임패스를 만든 뒤 ID를 여기에 넣는다.
	Gamepass2xId = 0,

	UpgradeOrder = { "ClickPower", "AutoIncome", "Multiplier" },
	Upgrades = {
		ClickPower = {
			Name = "클릭 파워",
			Desc = "클릭당 +1 코인",
			BaseCost = 10,
			CostGrowth = 1.15,
			PerLevel = 1,
		},
		AutoIncome = {
			Name = "자동 수입",
			Desc = "초당 +1 코인",
			BaseCost = 50,
			CostGrowth = 1.18,
			PerLevel = 1,
		},
		Multiplier = {
			Name = "코인 배수",
			Desc = "모든 수입 +50%",
			BaseCost = 1000,
			CostGrowth = 2.2,
			PerLevel = 0.5,
		},
	},
}
