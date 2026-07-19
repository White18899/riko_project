import os
from PIL import Image, ImageDraw

def generate_all_frames():
    base_path = "server/static/character_neutral.png"
    if not os.path.exists(base_path):
        print(f"Error: Base image not found at {base_path}")
        return

    # Load base image
    base_img = Image.open(base_path).convert("RGBA")
    w, h = base_img.size

    # Define color constants
    skin_color = (244, 187, 170, 255)
    line_color = (77, 47, 44, 255)
    tongue_color = (235, 120, 120, 255)
    blush_color = (255, 100, 100, 40) # Translucent blush

    # Bounding boxes
    # Mouth: (445, 350, 477, 389) -> center around (460, 370)
    # Left Eye: (480, 250, 523, 299) -> center around (501, 275)
    # Right Eye: (400, 250, 439, 269) -> center around (419, 260)

    # Helper: Erase mouth region by copying nearby skin texture
    def erase_mouth(img):
        # Copy skin from just above the mouth (y: 335 to 348) down to mouth region (y: 350 to 385)
        skin_patch = img.crop((440, 335, 482, 348))
        # Draw gradient/paste skin patch repeatedly to cover
        for y_offset in range(15, 55, 12):
            img.paste(skin_patch, (440, 335 + y_offset))

    # Helper: Erase left eye region by copying nearby forehead skin
    def erase_left_eye(img):
        skin_patch = img.crop((480, 225, 525, 245))
        for y_offset in range(25, 75, 18):
            img.paste(skin_patch, (480, 225 + y_offset))

    # Helper: Erase right eye region
    def erase_right_eye(img):
        skin_patch = img.crop((400, 225, 440, 245))
        for y_offset in range(25, 55, 15):
            img.paste(skin_patch, (400, 225 + y_offset))

    # --- 1. GENERATE NEUTRAL BLINKING FRAMES (1 to 5) ---
    # Frame 1: Eyes wide open (original)
    base_img.save("server/static/character_neutral_1.png")

    # Frame 2: Eyes slightly closed
    f2 = base_img.copy()
    draw = ImageDraw.Draw(f2)
    # Erase top 15 pixels of eyes and draw a line
    draw.rectangle([480, 250, 523, 265], fill=skin_color)
    draw.rectangle([400, 250, 439, 255], fill=skin_color)
    draw.line([(480, 265), (523, 265)], fill=line_color, width=2)
    draw.line([(400, 255), (439, 255)], fill=line_color, width=2)
    f2.save("server/static/character_neutral_2.png")

    # Frame 3: Eyes half closed
    f3 = base_img.copy()
    draw = ImageDraw.Draw(f3)
    draw.rectangle([480, 250, 523, 275], fill=skin_color)
    draw.rectangle([400, 250, 439, 260], fill=skin_color)
    draw.line([(480, 275), (523, 275)], fill=line_color, width=2)
    draw.line([(400, 260), (439, 260)], fill=line_color, width=2)
    f3.save("server/static/character_neutral_3.png")

    # Frame 4: Eyes fully closed (Blinking)
    f4 = base_img.copy()
    erase_left_eye(f4)
    erase_right_eye(f4)
    draw = ImageDraw.Draw(f4)
    # Draw curved closed eye lashes
    draw.arc([482, 270, 520, 288], 0, 180, fill=line_color, width=3)
    draw.arc([402, 260, 438, 274], 0, 180, fill=line_color, width=3)
    f4.save("server/static/character_neutral_4.png")

    # Frame 5: Eyes half open (same as Frame 3)
    f3.save("server/static/character_neutral_5.png")

    # --- 2. GENERATE SPEAKING FRAMES (1 to 5) ---
    # Speaking mouths are drawn as open ellipses with dark brown background and pink tongue
    speaking_mouths = [
        # Frame 1: Small open mouth
        (8, 4),
        # Frame 2: Medium open mouth
        (10, 8),
        # Frame 3: Large open mouth
        (12, 14),
        # Frame 4: Wide open mouth
        (14, 18),
        # Frame 5: Rounded open mouth
        (10, 10)
    ]
    for idx, (mw, mh) in enumerate(speaking_mouths, start=1):
        f_speak = base_img.copy()
        erase_mouth(f_speak)
        draw = ImageDraw.Draw(f_speak)
        cx, cy = 460, 370
        # Draw mouth cavity
        draw.ellipse([cx - mw, cy - mh, cx + mw, cy + mh], fill=line_color)
        # Draw tongue in bottom half
        draw.chord([cx - mw + 1, cy, cx + mw - 1, cy + mh - 1], 0, 180, fill=tongue_color)
        f_speak.save(f"server/static/character_speaking_{idx}.png")

    # --- 3. GENERATE HAPPY FRAMES (1 to 5) ---
    # Happy eyes are curved upward smiles, and mouth is smiling
    happy_mouths = [
        # Frame 1: Small curved smile line
        ("arc", 12, 4),
        # Frame 2: Wider curved smile line
        ("arc", 16, 6),
        # Frame 3: Small open smile
        ("chord", 10, 6),
        # Frame 4: Medium open smile
        ("chord", 12, 10),
        # Frame 5: Laughing wide open mouth
        ("chord", 14, 14)
    ]
    for idx, (mtype, mw, mh) in enumerate(happy_mouths, start=1):
        f_happy = base_img.copy()
        erase_mouth(f_happy)
        erase_left_eye(f_happy)
        erase_right_eye(f_happy)
        
        draw = ImageDraw.Draw(f_happy)
        cx, cy = 460, 370
        
        # Draw happy eyes (curved upwards arcs)
        draw.arc([482, 260, 520, 282], 180, 360, fill=line_color, width=3)
        draw.arc([402, 252, 438, 270], 180, 360, fill=line_color, width=3)
        
        # Draw happy mouth
        if mtype == "arc":
            draw.arc([cx - mw, cy - mh, cx + mw, cy + mh], 0, 180, fill=line_color, width=3)
        else:
            # Open smiling mouth filled with red/pink tongue
            draw.chord([cx - mw, cy - mh, cx + mw, cy + mh], 0, 180, fill=line_color)
            draw.chord([cx - mw + 1, cy, cx + mw - 1, cy + mh - 1], 0, 180, fill=tongue_color)
            
        f_happy.save(f"server/static/character_happy_{idx}.png")

    # --- 4. GENERATE ANNOYED FRAMES (1 to 5) ---
    # Annoyed eyes are angry angled slants, mouth is pouting downward
    annoyed_mouths = [
        # Frame 1: Flat line
        ("line", 12, 0),
        # Frame 2: Downward curve
        ("arc", 10, 4),
        # Frame 3: Small pouting circle/wavy
        ("pout", 6, 6),
        # Frame 4: Downward curve with blush
        ("arc", 12, 6),
        # Frame 5: Flat line with blush
        ("line", 14, 0)
    ]
    for idx, (mtype, mw, mh) in enumerate(annoyed_mouths, start=1):
        f_annoyed = base_img.copy()
        erase_mouth(f_annoyed)
        erase_left_eye(f_annoyed)
        erase_right_eye(f_annoyed)
        
        draw = ImageDraw.Draw(f_annoyed)
        cx, cy = 460, 370
        
        # Draw angry slanted eyebrows and eyes
        draw.line([(480, 260), (518, 278)], fill=line_color, width=3) # Slanted down-in
        draw.line([(404, 268), (436, 256)], fill=line_color, width=3) # Slanted down-in
        
        # Draw angry eyes (circles with slanted tops)
        draw.ellipse([484, 270, 514, 296], fill=line_color)
        draw.ellipse([406, 262, 432, 282], fill=line_color)
        draw.polygon([(480, 255), (522, 275), (522, 255)], fill=skin_color)
        draw.polygon([(400, 264), (438, 252), (400, 252)], fill=skin_color)
        
        # Draw annoyed mouth
        if mtype == "line":
            draw.line([(cx - mw, cy), (cx + mw, cy)], fill=line_color, width=3)
        elif mtype == "arc":
            draw.arc([cx - mw, cy - mh, cx + mw, cy + mh], 180, 360, fill=line_color, width=3)
        elif mtype == "pout":
            # Small wavy pouting mouth
            draw.arc([cx - mw, cy - mh, cx, cy], 0, 180, fill=line_color, width=3)
            draw.arc([cx, cy, cx + mw, cy + mh], 180, 360, fill=line_color, width=3)
            
        # Add blush for frames 4 and 5
        if idx >= 4:
            # Draw two rosy cheeks
            draw.ellipse([475, 295, 525, 325], fill=blush_color)
            draw.ellipse([395, 285, 435, 315], fill=blush_color)
            
        f_annoyed.save(f"server/static/character_annoyed_{idx}.png")

    # --- 5. GENERATE THINKING FRAMES (1 to 5) ---
    # Thinking eyes look up/to the side, mouth is a small neutral line or dot
    thinking_mouths = [
        # Frame 1: Small flat line
        ("line", 8),
        # Frame 2: Tiny dot
        ("dot", 4),
        # Frame 3: Small wavy line
        ("wave", 8),
        # Frame 4: Slightly open 'o'
        ("circle", 6),
        # Frame 5: Small flat line
        ("line", 8)
    ]
    for idx, (mtype, mw) in enumerate(thinking_mouths, start=1):
        f_think = base_img.copy()
        erase_mouth(f_think)
        erase_left_eye(f_think)
        erase_right_eye(f_think)
        
        draw = ImageDraw.Draw(f_think)
        cx, cy = 460, 370
        
        # Draw thinking eyes (narrower, pupils shifted up/left)
        # Left eye outline
        draw.ellipse([480, 260, 523, 290], outline=line_color, width=2)
        # Pupil shifted up
        draw.ellipse([490, 262, 508, 280], fill=line_color)
        
        # Right eye outline
        draw.ellipse([400, 252, 439, 276], outline=line_color, width=2)
        draw.ellipse([410, 254, 426, 270], fill=line_color)
        
        # Draw thinking mouth
        if mtype == "line":
            draw.line([(cx - mw, cy), (cx + mw, cy)], fill=line_color, width=3)
        elif mtype == "dot":
            draw.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=line_color)
        elif mtype == "wave":
            draw.arc([cx - mw, cy - 2, cx, cy + 2], 0, 180, fill=line_color, width=3)
            draw.arc([cx, cy - 2, cx + mw, cy + 2], 180, 360, fill=line_color, width=3)
        elif mtype == "circle":
            draw.ellipse([cx - mw//2, cy - mw//2, cx + mw//2, cy + mw//2], outline=line_color, width=3)
            
        f_think.save(f"server/static/character_thinking_{idx}.png")

    print("Successfully generated all 25 character expression frames programmatically!")

if __name__ == "__main__":
    generate_all_frames()
