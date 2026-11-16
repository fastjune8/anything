# FRONTIER 총 모델 템플릿 (Blender 4.x)
# 사용법: Blender → Scripting 탭 → 열기(이 파일) → ▶ 실행
#   - 단위를 맞추고 (Metric, 배율 1.0, cm 로 표시)
#   - 색 칸 재질 6개(body, body2, dark, metal, accent, core)와
#   - 부착 지점 빈 물체(socket_…)를 기본 위치(돌격소총 기준)에 만든다.
#   이미 있는 것은 건드리지 않으므로 여러 번 실행해도 된다. 규칙: docs/GUN_MODELING.md
#
# 내보내기: 맨 아래 EXPORT_PATH 에 경로를 적고 다시 실행하면 규칙대로 .glb 로 내보낸다.
#   (Ctrl+A 로 변환 적용은 먼저 해 두자)
import bpy

EXPORT_PATH = ""  # 예: "/Users/나/frontier_guns/vk12.glb"  (비워 두면 내보내지 않음)

COLLECTION = "FRONTIER_GUN"

# 색 칸 재질: 이름 → (색, 빛남 여부). 색은 참고 이미지 기준 예시
MATERIALS = {
    "body": ("#e0a24a", False),
    "body2": ("#c27f34", False),
    "dark": ("#262b36", False),
    "metal": ("#3a3f47", False),
    "accent": ("#d8382e", False),
    "core": ("#3ad7ff", True),
}

# 부착 지점 (Blender 좌표: 총구 = +Y, 위 = +Z, 오른쪽 = +X, 단위 m). 돌격소총 길이 약 0.9m 기준 위치
SOCKETS = {
    "socket_ads": (0.0, -0.09, 0.064),      # 가늠자 구멍 중심
    "socket_muzzle": (0.0, 0.52, 0.0),      # 총구 끝
    "socket_hand_r": (0.0, -0.07, -0.085),  # 오른손 (손잡이)
    "socket_hand_l": (0.0, 0.26, -0.045),   # 왼손 (총열 덮개)
    "socket_optic": (0.0, 0.02, 0.042),     # 조준경 받침 (레일 윗면)
    "socket_grip": (0.0, 0.27, -0.03),      # 앞 손잡이 (총열 덮개 아랫면)
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def setup_units():
    u = bpy.context.scene.unit_settings
    u.system = "METRIC"
    u.scale_length = 1.0
    u.length_unit = "CENTIMETERS"  # 표시만 cm, 내부 단위는 m 그대로


def ensure_collection():
    coll = bpy.data.collections.get(COLLECTION)
    if coll is None:
        coll = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(coll)
    return coll


def ensure_material(name, hex_color, glow):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    srgb = hex_rgb(hex_color)
    lin = tuple(srgb_to_linear(c) for c in srgb)
    mat.diffuse_color = (*srgb, 1.0)  # 솔리드 보기에서 보이는 색
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.75
        if glow:
            key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
            bsdf.inputs[key].default_value = (*lin, 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 3.0
    return mat


def ensure_socket(coll, name, loc):
    obj = bpy.data.objects.get(name)
    if obj is not None:
        return obj  # 이미 옮겨 둔 위치를 덮어쓰지 않는다
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = 0.008
    obj.location = loc
    obj.show_name = True
    coll.objects.link(obj)
    return obj


def export_glb(path):
    """규칙대로 .glb 로 내보낸다 (+Y Up, 모디파이어 적용, 압축 없음, 애니메이션 없음)."""
    opts = dict(
        filepath=path, export_format="GLB", export_yup=True, export_apply=True,
        export_extras=True, export_cameras=False, export_lights=False, use_selection=False,
    )
    try:
        bpy.ops.export_scene.gltf(**opts)
    except TypeError:  # Blender 버전에 따라 없는 옵션이 있으면 기본 옵션만
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    print(f"[FRONTIER] 내보냄: {path}")


def main():
    setup_units()
    coll = ensure_collection()
    for name, (color, glow) in MATERIALS.items():
        ensure_material(name, color, glow)
    for name, loc in SOCKETS.items():
        ensure_socket(coll, name, loc)
    print("[FRONTIER] 준비 완료: 재질 6개, 부착 지점 6개 (FRONTIER_GUN 컬렉션). 규칙은 docs/GUN_MODELING.md")
    if EXPORT_PATH:
        export_glb(EXPORT_PATH)


main()
