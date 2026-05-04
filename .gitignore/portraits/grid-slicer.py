import os
from PIL import Image

def slice_portraits_interactive():
    # --- User Inputs ---
    image_path = input("Enter the path to the source JPEG (e.g., grid.jpg): ").strip()
    output_dir = input("Enter the output directory (e.g., output_portraits): ").strip()
    
    try:
        rows = int(input("Enter number of ROWS: "))
        cols = int(input("Enter number of COLUMNS: "))
    except ValueError:
        print("Error: Rows and Columns must be integers.")
        return

    if not os.path.exists(image_path):
        print(f"Error: File '{image_path}' not found.")
        return

    # Create output directory if it doesn't exist
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    try:
        with Image.open(image_path) as img:
            img = img.convert("RGB")
            width, height = img.size
            bg_color = img.getpixel((0, 0))
            
            print(f"Processing {width}x{height} image...")

            # Helper to find content boundaries (ignoring gutters/margins)
            def get_content_ranges(size, is_width, count):
                ranges = []
                in_content = False
                start = 0
                for i in range(size):
                    is_bg_slice = True
                    # Scan a sample of the cross-section
                    for j in range(0, (height if is_width else width), 10):
                        pixel = img.getpixel((i, j)) if is_width else img.getpixel((j, i))
                        if sum(abs(pixel[k] - bg_color[k]) for k in range(3)) > 40:
                            is_bg_slice = False
                            break
                    
                    if not in_content and not is_bg_slice:
                        in_content = True
                        start = i
                    elif in_content and is_bg_slice:
                        in_content = False
                        ranges.append((start, i))
                
                # Sort by size and take the top 'count' segments to filter out noise
                found = sorted(ranges, key=lambda x: x[1]-x[0], reverse=True)[:count]
                return sorted(found)

            col_ranges = get_content_ranges(width, True, cols)
            row_ranges = get_content_ranges(height, False, rows)

            if len(col_ranges) < cols or len(row_ranges) < rows:
                print(f"Warning: Only detected {len(row_ranges)} rows and {len(col_ranges)} columns.")

            idx = 1
            for r_start, r_end in row_ranges:
                for c_start, c_end in col_ranges:
                    portrait = img.crop((c_start, r_start, c_end, r_end))
                    filename = f"portrait-{idx:03}.jpg"
                    portrait.save(os.path.join(output_dir, filename), "JPEG", quality=95)
                    idx += 1

            print(f"\nSuccess! {idx-1} portraits saved to '{output_dir}/'.")

    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    slice_portraits_interactive()