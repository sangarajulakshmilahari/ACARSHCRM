(()=>{var e={};e.id=705,e.ids=[705],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},8332:(e,t,a)=>{"use strict";a.r(t),a.d(t,{originalPathname:()=>L,patchFetch:()=>C,requestAsyncStorage:()=>p,routeModule:()=>d,serverHooks:()=>N,staticGenerationAsyncStorage:()=>m});var o={};a.r(o),a.d(o,{GET:()=>i,POST:()=>l});var r=a(9303),s=a(8716),n=a(670),c=a(7070),u=a(9364);async function i(){try{let e=await (0,u.M)(),[t]=await e.query(`
      SELECT
        l.LeadId,
        l.CompanyName,
        l.CompanyLocation,
        l.LeadSource,
        l.LeadDate,
        l.LeadNotes,
        ls.StatusName,
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        cr.Role AS ContactRoleName,
        u.UserName AS OwnerName,
        at.AccountTypeId,
        at.Name
      FROM Leads l
      LEFT JOIN LeadStatuses ls
        ON l.StatusId = ls.StatusId
      LEFT JOIN LeadContacts lc
        ON lc.LeadId = l.LeadId
      LEFT JOIN ContactRoles cr
        ON lc.ContactRoleId = cr.RoleId
      LEFT JOIN Users u
        ON l.OwnerId = u.UserId
      LEFT JOIN AccountTypes at
        ON l.AccountTypeId = at.AccountTypeId
      WHERE at.Name = 'Account'
    `),a={};return t.forEach(e=>{a[e.LeadId]||(a[e.LeadId]={LeadId:e.LeadId,CompanyName:e.CompanyName,CompanyLocation:e.CompanyLocation,LeadSource:e.LeadSource,LeadDate:e.LeadDate,LeadNotes:e.LeadNotes,StatusName:e.StatusName,OwnerName:e.OwnerName,AccountTypeId:e.AccountTypeId,Name:e.Name,Contacts:[]}),(e.ContactName||e.ContactEmail||e.ContactPhone)&&a[e.LeadId].Contacts.push({ContactName:e.ContactName,ContactTitle:e.ContactTitle,ContactEmail:e.ContactEmail,ContactPhone:e.ContactPhone,ContactRoleName:e.ContactRoleName})}),c.NextResponse.json(Object.values(a))}catch(e){return console.error("Error fetching prospect leads:",e),c.NextResponse.json({error:"Failed to fetch prospect leads"},{status:500})}}async function l(e){let t;try{let{CompanyName:a,CompanyLocation:o,LeadSource:r,LeadDate:s,StatusName:n,OwnerName:i,Notes:l,ContactName:d,ContactEmail:p,ContactPhone:m,ContactTitle:N,ContactRoleName:L,AddReminder:C}=await e.json(),I=await (0,u.M)();t=await I.getConnection(),await t.beginTransaction();let[E]=await t.query("SELECT StatusId FROM LeadStatuses WHERE StatusName = ?",[n]),y=E[0]?.StatusId??1,[S]=await t.query("SELECT UserId FROM Users WHERE UserName = ?",[i]),R=S[0]?.UserId??null,[T]=await t.query("SELECT AccountTypeId FROM AccountTypes WHERE Name = ?",["Account"]),O=T[0]?.AccountTypeId??null,[x]=await t.query(`
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, StatusId, OwnerId, AccountTypeId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,[a,o,r,s,l,y,R,O]),A=x.insertId;if(d||p||m){if(!L)return await t.rollback(),c.NextResponse.json({error:"Contact role is required"},{status:400});let[e]=await t.query("SELECT RoleId FROM ContactRoles WHERE Role = ?",[L]);if(!e.length)return await t.rollback(),c.NextResponse.json({error:"Invalid Contact Role"},{status:400});let a=e[0].RoleId;await t.query(`
        INSERT INTO LeadContacts
          (LeadId, ContactName, ContactEmail, ContactPhone, ContactTitle, ContactRoleId)
        VALUES (?, ?, ?, ?, ?, ?)
        `,[A,d,p,m,N,a])}return C&&await t.query(`
        INSERT INTO Reminders (LeadId, ReminderDate)
        VALUES (?, NOW())
        `,[A]),await t.commit(),c.NextResponse.json({message:"Account created successfully",LeadId:A},{status:200})}catch(e){return t&&await t.rollback(),console.error("Error creating account:",e),c.NextResponse.json({error:"Failed to create account",details:e.message},{status:500})}finally{t&&t.release()}}let d=new r.AppRouteRouteModule({definition:{kind:s.x.APP_ROUTE,page:"/api/employees/account/route",pathname:"/api/employees/account",filename:"route",bundlePath:"app/api/employees/account/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/account/route.ts",nextConfigOutput:"standalone",userland:o}),{requestAsyncStorage:p,staticGenerationAsyncStorage:m,serverHooks:N}=d,L="/api/employees/account/route";function C(){return(0,n.patchFetch)({serverHooks:N,staticGenerationAsyncStorage:m})}},9364:(e,t,a)=>{"use strict";a.d(t,{M:()=>n});var o=a(3785);let r={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},s=null;async function n(){return s||(s=o.createPool(r)),s}}};var t=require("../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),o=t.X(0,[948,972,785],()=>a(8332));module.exports=o})();