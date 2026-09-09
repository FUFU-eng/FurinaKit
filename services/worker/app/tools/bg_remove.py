from pathlib import Path

from PIL import Image
from rembg import remove, new_session

from app.storage_paths import results_dir

_ALLOWED_MODELS = {"u2net", "isnet-general-use"}


def remove_background(input_path: str, model: str = "u2net", bg_color: str = None) -> tuple[str, str]:
    if model not in _ALLOWED_MODELS:
        model = "u2net"

    session = new_session(model)
    with Image.open(input_path) as image:
        output = remove(image, session=session)

    # 自动抠图默认导出为包含透明通道的 PNG 格式
    filename = f"{Path(input_path).stem}-nobg.png"
    output_path = results_dir() / filename

    if bg_color and bg_color.lower() not in ("transparent", "none"):
        try:
            from PIL import ImageColor
            rgb = ImageColor.getrgb(bg_color)
        except Exception:
            rgb = (255, 255, 255)
        bg_img = Image.new("RGB", output.size, rgb)
        bg_img.paste(output, mask=output.split()[3] if output.mode == "RGBA" else None)
        bg_img.save(output_path, format="PNG")
    else:
        output.save(output_path, format="PNG")

    return str(output_path), filename
