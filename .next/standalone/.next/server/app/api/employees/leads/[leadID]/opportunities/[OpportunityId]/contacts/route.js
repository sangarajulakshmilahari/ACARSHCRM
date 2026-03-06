(()=>{var e={};e.id=157,e.ids=[157],e.modules={2849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=2849,e.exports=t},399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},8893:e=>{"use strict";e.exports=require("buffer")},4770:e=>{"use strict";e.exports=require("crypto")},7702:e=>{"use strict";e.exports=require("events")},8216:e=>{"use strict";e.exports=require("net")},5816:e=>{"use strict";e.exports=require("process")},6162:e=>{"use strict";e.exports=require("stream")},4026:e=>{"use strict";e.exports=require("string_decoder")},5346:e=>{"use strict";e.exports=require("timers")},2452:e=>{"use strict";e.exports=require("tls")},7360:e=>{"use strict";e.exports=require("url")},1764:e=>{"use strict";e.exports=require("util")},1568:e=>{"use strict";e.exports=require("zlib")},4190:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>L,patchFetch:()=>f,requestAsyncStorage:()=>y,routeModule:()=>E,serverHooks:()=>O,staticGenerationAsyncStorage:()=>C});var n={};r.r(n),r.d(n,{DELETE:()=>m,GET:()=>p,POST:()=>c,PUT:()=>d});var o=r(9303),i=r(8716),s=r(670),a=r(7070),l=r(9364);let u=e=>e?new Date(e).toISOString().split("T")[0]:null;async function p(e,{params:t}){try{let e=Number(t.OpportunityId);if(isNaN(e))return a.NextResponse.json({error:"Invalid OpportunityId"},{status:400});let r=await (0,l.M)(),[n]=await r.query(`
      SELECT
        OpportunityContactId,
        OpportunityId,

        FullName,
        FirstName,
        LastName,
        PreferredName,
        JobTitle,
        Department,
        SeniorityLevel,
        Gender,
        DateOfBirth,
        ProfilePictureUrl,

        CompanyName,
        Division,
        OfficeLocation,
        HeadquartersLocation,
        EmployeeSize,
        Industry,
        CompanyWebsite,
        CompanyLinkedInPage,

        WorkEmail,
        PersonalEmail,
        DirectPhone,
        MobilePhone,
        OfficePhone,
        LinkedInProfileUrl
      FROM OpportunityContacts
      WHERE OpportunityId = ?
        AND IsDeleted = 0
      ORDER BY OpportunityContactId
      `,[e]);return a.NextResponse.json(n)}catch(e){return console.error("Get opportunity contacts error:",e),a.NextResponse.json({error:"Failed to fetch opportunity contacts"},{status:500})}}async function c(e,{params:t}){try{let r=Number(t.OpportunityId);if(!r)return a.NextResponse.json({error:"Invalid OpportunityId"},{status:400});let n=await e.json();if(!Array.isArray(n)||0===n.length)return a.NextResponse.json({error:"No contacts provided"},{status:400});let o=await (0,l.M)(),i=`
      INSERT INTO OpportunityContacts (
        OpportunityId,
        FullName,
        FirstName,
        LastName,
        PreferredName,
        JobTitle,
        Department,
        SeniorityLevel,
        Gender,
        DateOfBirth,
        ProfilePictureUrl,
        CompanyName,
        Division,
        OfficeLocation,
        HeadquartersLocation,
        EmployeeSize,
        Industry,
        CompanyWebsite,
        CompanyLinkedInPage,
        WorkEmail,
        PersonalEmail,
        DirectPhone,
        MobilePhone,
        OfficePhone,
        LinkedInProfileUrl
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;for(let e of n){let t=[r,e.FullName??null,e.FirstName??null,e.LastName??null,e.PreferredName??null,e.JobTitle??null,e.Department??null,e.SeniorityLevel??null,e.Gender??null,u(e.DateOfBirth),e.ProfilePictureUrl??null,e.CompanyName??null,e.Division??null,e.OfficeLocation??null,e.HeadquartersLocation??null,e.EmployeeSize?Number(e.EmployeeSize):null,e.Industry??null,e.CompanyWebsite??null,e.CompanyLinkedInPage??null,e.WorkEmail??null,e.PersonalEmail??null,e.DirectPhone??null,e.MobilePhone??null,e.OfficePhone??null,e.LinkedInProfileUrl??null];await o.query(i,t)}return a.NextResponse.json({success:!0})}catch(e){return console.error("Save Opportunity Contacts Error:",e),a.NextResponse.json({error:"Failed to save opportunity contacts"},{status:500})}}async function d(e,{params:t}){let r=await e.json(),n=await (0,l.M)();return r.OpportunityContactId?(await n.query(`
    UPDATE OpportunityContacts
    SET
      FullName = COALESCE(?, FullName),
      FirstName = COALESCE(?, FirstName),
      LastName = COALESCE(?, LastName),
      PreferredName = COALESCE(?, PreferredName),

      JobTitle = COALESCE(?, JobTitle),
      Department = COALESCE(?, Department),
      SeniorityLevel = COALESCE(?, SeniorityLevel),
      Gender = COALESCE(?, Gender),
      DateOfBirth = COALESCE(?, DateOfBirth),

      ProfilePictureUrl = COALESCE(?, ProfilePictureUrl),

      CompanyName = COALESCE(?, CompanyName),
      Division = COALESCE(?, Division),
      OfficeLocation = COALESCE(?, OfficeLocation),
      HeadquartersLocation = COALESCE(?, HeadquartersLocation),
      EmployeeSize = COALESCE(?, EmployeeSize),
      Industry = COALESCE(?, Industry),
      CompanyWebsite = COALESCE(?, CompanyWebsite),
      CompanyLinkedInPage = COALESCE(?, CompanyLinkedInPage),

      WorkEmail = COALESCE(?, WorkEmail),
      PersonalEmail = COALESCE(?, PersonalEmail),
      DirectPhone = COALESCE(?, DirectPhone),
      MobilePhone = COALESCE(?, MobilePhone),
      OfficePhone = COALESCE(?, OfficePhone),

      LinkedInProfileUrl = COALESCE(?, LinkedInProfileUrl)
    WHERE OpportunityContactId = ?
    `,[r.FullName??null,r.FirstName??null,r.LastName??null,r.PreferredName??null,r.JobTitle??null,r.Department??null,r.SeniorityLevel??null,r.Gender??null,u(r.DateOfBirth),r.ProfilePictureUrl??null,r.CompanyName??null,r.Division??null,r.OfficeLocation??null,r.HeadquartersLocation??null,r.EmployeeSize?Number(r.EmployeeSize):null,r.Industry??null,r.CompanyWebsite??null,r.CompanyLinkedInPage??null,r.WorkEmail??null,r.PersonalEmail??null,r.DirectPhone??null,r.MobilePhone??null,r.OfficePhone??null,r.LinkedInProfileUrl??null,r.OpportunityContactId]),a.NextResponse.json({success:!0})):a.NextResponse.json({error:"OpportunityContactId is required for update"},{status:400})}async function m(e){try{let{OpportunityContactId:t}=await e.json();if(!t)return a.NextResponse.json({error:"OpportunityContactId is required"},{status:400});let r=await (0,l.M)();return await r.query(`
      UPDATE OpportunityContacts
      SET IsDeleted = 1
      WHERE OpportunityContactId = ?
      `,[t]),a.NextResponse.json({success:!0})}catch(e){return console.error("Delete Opportunity Contact Error:",e),a.NextResponse.json({error:"Failed to delete contact"},{status:500})}}let E=new o.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/employees/leads/[leadID]/opportunities/[OpportunityId]/contacts/route",pathname:"/api/employees/leads/[leadID]/opportunities/[OpportunityId]/contacts",filename:"route",bundlePath:"app/api/employees/leads/[leadID]/opportunities/[OpportunityId]/contacts/route"},resolvedPagePath:"/home/ubuntu/Acarsh/Acarsh123/app/api/employees/leads/[leadID]/opportunities/[OpportunityId]/contacts/route.ts",nextConfigOutput:"standalone",userland:n}),{requestAsyncStorage:y,staticGenerationAsyncStorage:C,serverHooks:O}=E,L="/api/employees/leads/[leadID]/opportunities/[OpportunityId]/contacts/route";function f(){return(0,s.patchFetch)({serverHooks:O,staticGenerationAsyncStorage:C})}},9364:(e,t,r)=>{"use strict";r.d(t,{M:()=>s});var n=r(3785);let o={host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,waitForConnections:!0,connectionLimit:10,queueLimit:0},i=null;async function s(){return i||(i=n.createPool(o)),i}}};var t=require("../../../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),n=t.X(0,[948,972,785],()=>r(4190));module.exports=n})();