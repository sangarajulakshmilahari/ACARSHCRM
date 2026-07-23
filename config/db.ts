import mysql from "mysql2/promise";
 
const config = {
  host: "localhost",    
  user: "root",          
  password: "Mahesh@2003567",      
  database: "acarsh_db",
 
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};
 
let pool: mysql.Pool | null = null;
 
export async function getPool(): Promise<mysql.Pool> {
  if (!pool) {
    pool = mysql.createPool(config);
  }
  return pool;
}
 
 
 