    import { NextResponse } from "next/server";
    import { getPool } from "@/config/db";

    export const dynamic = "force-dynamic";
    export const revalidate = 0;

    export async function GET() {
      try {
        const pool = await getPool();

        const [rows]: any = await pool.query(`
          SELECT
            c.CategoryId,
            c.CategoryName,
            sc.SubCategoryId,
            sc.SubCategoryName,
            sc.ParentSubCategoryId
          FROM Category c
          JOIN SubCategory sc
            ON sc.CategoryId = c.CategoryId
          ORDER BY
            c.CategoryId,
            sc.ParentSubCategoryId,
            sc.SubCategoryId
        `);

        const map = new Map<number, any>();

      
          //  PASS 1: Categories + Parent SubCategories
      
        for (const row of rows) {
          if (!map.has(row.CategoryId)) {
            map.set(row.CategoryId, {
              CategoryId: row.CategoryId,
              CategoryName: row.CategoryName,
              SubCategories: [],
            });
          }

          if (row.ParentSubCategoryId === null) {
            map.get(row.CategoryId).SubCategories.push({
              SubCategoryId: row.SubCategoryId,
              SubCategoryName: row.SubCategoryName,
              Children: [],
            });
          }
        }

      
          //  PASS 2: Attach Child SubCategories
    
        for (const row of rows) {
          if (row.ParentSubCategoryId !== null) {
            const category = map.get(row.CategoryId);
            const parent = category?.SubCategories.find(
              (p: any) => p.SubCategoryId === row.ParentSubCategoryId
            );

            if (parent) {
              parent.Children.push({
                SubCategoryId: row.SubCategoryId,
                SubCategoryName: row.SubCategoryName,
              });
            }
          }
        }

        return NextResponse.json(Array.from(map.values()));
      } catch (err) {
        console.error("Category fetch error:", err);
        return NextResponse.json(
          { error: "Failed to load categories" },
          { status: 500 }
        );
      }
    }
