#!/usr/bin/env python3
"""
Script: update_missing_brands.py

Usage:
  python update_missing_brands.py <excel-file-path> [--env <env-file>]

What it does:
  - Reads an Excel file with columns like 'Mã hàng hóa' / 'Mã hang hoa' / 'productCode',
    and 'Nhãn hàng' / 'Brand' for brand names.
  - For each row, finds the product by `product_code` column in `products` table.
  - If the product exists and its brand column is NULL, ensures the brand exists in
    `brands` table (create if missing) and sets the product's brand FK to that brand id.
  - If product already has a brand, the script will NOT change it (even if Excel has
    a different brand value).

Dependencies:
  pip install pandas openpyxl python-dotenv pymysql python-slugify

Run from repository root (recommended):
  cd Backend
  python scripts/update_missing_brands.py ../path/to/file.xlsx

The script will read DB credentials from the provided .env file (default: Backend/.env).
"""

import os
import sys
import argparse
from typing import Optional

try:
    import pandas as pd
except ImportError:
    print("Missing dependency: pandas. Install with: pip install pandas openpyxl")
    sys.exit(1)

try:
    import pymysql
except ImportError:
    print("Missing dependency: pymysql. Install with: pip install pymysql")
    sys.exit(1)

try:
    from slugify import slugify
except ImportError:
    print("Missing dependency: python-slugify. Install with: pip install python-slugify")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependency: python-dotenv. Install with: pip install python-dotenv")
    sys.exit(1)


def detect_column(df, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    # try case-insensitive match
    cols_lower = {col.lower(): col for col in df.columns}
    for c in candidates:
        if c.lower() in cols_lower:
            return cols_lower[c.lower()]
    return None


def make_slug(name: str) -> str:
    return slugify(name, lowercase=True)


def get_existing_column(conn, db_name, table_name, candidates):
    with conn.cursor() as cur:
        q = """
        SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s
        """
        cur.execute(q, (db_name, table_name))
        rows = cur.fetchall()
        cols = [r[0] for r in rows]
        for cand in candidates:
            if cand in cols:
                return cand
        # case-insensitive
        lower_map = {c.lower(): c for c in cols}
        for cand in candidates:
            if cand.lower() in lower_map:
                return lower_map[cand.lower()]
    return None


def main():
    parser = argparse.ArgumentParser(description='Update missing brands for products from Excel')
    parser.add_argument('excel', help='Path to Excel file')
    parser.add_argument('--env', help='Path to .env file (default: Backend/.env)', default=None)
    args = parser.parse_args()

    # determine default env path relative to repo: Backend/.env
    env_path = args.env or os.path.join(os.path.dirname(__file__), '..', '.env')
    env_path = os.path.abspath(env_path)
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"Loaded env from {env_path}")
    else:
        print(f"Env file not found at {env_path} - will use environment variables if available")

    db_host = os.getenv('DB_HOST', '127.0.0.1')
    db_port = int(os.getenv('DB_PORT', '3306'))
    db_user = os.getenv('DB_USERNAME') or os.getenv('DB_USER') or os.getenv('MYSQL_USER')
    db_pass = os.getenv('DB_PASSWORD') or os.getenv('MYSQL_PASSWORD')
    db_name = os.getenv('DB_NAME') or os.getenv('MYSQL_DATABASE')

    if not all([db_user, db_pass, db_name]):
        print('Missing DB credentials. Please set DB_USERNAME/DB_PASSWORD/DB_NAME in env or pass .env file.')
        sys.exit(1)

    print(f"Connecting to DB {db_name}@{db_host}:{db_port} as {db_user}")
    conn = pymysql.connect(host=db_host, port=db_port, user=db_user, password=db_pass, db=db_name, charset='utf8mb4')

    # read excel
    print(f"Reading Excel {args.excel}")
    df = pd.read_excel(args.excel, dtype=str)

    # detect columns
    code_col = detect_column(df, ['Mã hàng hóa', 'Ma hang hoa', 'MaHangHoa', 'productCode', 'product_code', 'MaHH', 'Mã hàng hóa'])
    brand_col = detect_column(df, ['Nhãn hàng', 'Nhãn hàng', 'Brand', 'brand', 'Nhãn_hàng'])

    if not code_col or not brand_col:
        print('Could not detect required columns. Found columns:')
        print(list(df.columns))
        sys.exit(1)

    print(f"Using columns -> code: '{code_col}', brand: '{brand_col}'")

    # determine actual column names in DB
    product_table = 'products'
    brands_table = 'brands'
    product_code_col = 'product_code'
    candidate_brand_cols = ['brand_id', 'brandId', 'brand']
    brand_fk_col = get_existing_column(conn, db_name, product_table, candidate_brand_cols)
    if not brand_fk_col:
        print(f"Could not find brand FK column in table '{product_table}'. Tried: {candidate_brand_cols}")
        conn.close()
        sys.exit(1)

    print(f"Detected product brand FK column: {brand_fk_col}")

    created_brands = 0
    updated_products = 0
    skipped_products = 0
    errors = 0

    for idx, row in df.iterrows():
        try:
            code = row.get(code_col)
            brand_name = row.get(brand_col)
            if pd.isna(code) or pd.isna(brand_name):
                skipped_products += 1
                continue
            code = str(code).strip()
            brand_name = str(brand_name).strip()
            if not code or not brand_name:
                skipped_products += 1
                continue

            with conn.cursor() as cur:
                # find product by product_code
                cur.execute(f"SELECT id, `{brand_fk_col}` FROM `{product_table}` WHERE `{product_code_col}`=%s LIMIT 1", (code,))
                prod = cur.fetchone()
                if not prod:
                    skipped_products += 1
                    continue
                prod_id = prod[0]
                prod_brand_val = prod[1]
                if prod_brand_val is not None and str(prod_brand_val).strip() != '':
                    # already has brand -> do nothing
                    skipped_products += 1
                    continue

                # ensure brand exists
                cur.execute(f"SELECT id FROM `{brands_table}` WHERE `name`=%s LIMIT 1", (brand_name,))
                b = cur.fetchone()
                if b:
                    brand_id = b[0]
                else:
                    # create slug and ensure uniqueness
                    base_slug = make_slug(brand_name)[:250]
                    slug = base_slug
                    suffix = 1
                    while True:
                        cur.execute(f"SELECT id FROM `{brands_table}` WHERE `slug`=%s LIMIT 1", (slug,))
                        if not cur.fetchone():
                            break
                        slug = f"{base_slug}-{suffix}"
                        suffix += 1
                    cur.execute(f"INSERT INTO `{brands_table}` (`name`, `slug`) VALUES (%s, %s)", (brand_name[:255], slug))
                    brand_id = cur.lastrowid
                    created_brands += 1

                # update product brand fk
                cur.execute(f"UPDATE `{product_table}` SET `{brand_fk_col}`=%s WHERE id=%s", (brand_id, prod_id))
                updated_products += 1
                conn.commit()
        except Exception as e:
            print(f"Error processing row {idx}: {e}")
            errors += 1

    conn.close()

    print('--- Done ---')
    print(f'Created brands: {created_brands}')
    print(f'Updated products: {updated_products}')
    print(f'Skipped products: {skipped_products}')
    print(f'Errors: {errors}')


if __name__ == '__main__':
    main()
