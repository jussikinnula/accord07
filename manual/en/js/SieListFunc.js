function SetSieCode(sieKey)
{
  var data    = new Array;
  data.Code   = sieKey;
  data.Sct  = sieKey.substring(7,8);
  data.Sc   = sieKey.substring(8,11);
  data.Sys  = sieKey.substring(11,14);
  data.Comp = sieKey.substring(14,19);
  data.Sitq = sieKey.substring(19,21);
  data.Supp = sieKey.substring(22,25);
  return(data);
}
function SieTitleItem(sieKey,contNum,strSymbol,strTitle,strSubTitle,strDgc,strScSys,strMifList)
{
  var i,j;
  var data    = new Array;
  var mifBuf  = strMifList.split(",");
  data.sieKey = new Array;
  data.sieKey[0] = SetSieCode(sieKey);
  data.contentsNum = contNum;
  data.Symbol  = strSymbol;
  data.Title  = strTitle;
  data.SubTitle = strSubTitle;
  data.Dgc  = strDgc;
  data.ScSys = strScSys;
  data.DgcList = new Array;
  data.DgcList[0]  = strDgc;
  if(mifBuf.length >= 2) {
    for(i=0,j=1;i<mifBuf.length;) {
      data.sieKey[j] = SetSieCode(mifBuf[i++]);
      data.DgcList[j++]  = mifBuf[i++];
    }
  }
  data.Display  = true;
  return(data);
}
function SieDTCTitleItem(sieKey,contNum,strSymbol,strTitle,strSubTitle,strDgc,strScSys,strMifList,strDTCList)
{
  var data    = new Array;
  var   i,j;
  var mifBuf  = strMifList.split(",");
  var dtcBuf  = strDTCList.split(",");
  data.sieKey = new Array;
  data.sieKey[0] = SetSieCode(sieKey);
  data.contentsNum = contNum;
  data.Symbol  = strSymbol;
  data.Title  = strTitle;
  data.SubTitle = strSubTitle;
  data.Dgc  = strDgc;
  data.ScSys = strScSys;
  data.DgcList = new Array;
  data.DgcList[0]  = strDgc;
  data.Dtc  = new Array;
  if(mifBuf.length >= 2) {
    for(i=0,j=1;i<mifBuf.length;) {
      data.sieKey[j] = SetSieCode(mifBuf[i++]);
      data.DgcList[j++]  = mifBuf[i++];
    }
  }
  for(i=0;i<dtcBuf.length;i++) {
    data.Dtc[i] = dtcBuf[i].toUpperCase();
  }
  data.Display  = true;
  return(data);
}


function CreateConditionInfo(strKey, strSct, strSc, strSys, strComp, strSitq)
{
  var  dataKey = new Array;
  var  dataSct = new Array;
  var  dataSc  = new Array;
  var  dataSys = new Array;
  var  dataComp = new Array;
  var  dataSitq = new Array;
  var  andKey = new Array;
  var  andSct = new Array;
  var  andSc  = new Array;
  var  andSys = new Array;
  var  andComp = new Array;
  var  andSitq = new Array;
  var  idx,count;

//  strKey  = strKey.substring(1,strKey.length-1);
//  strSct  = strSct.substring(1,strSct.length-1);
//  strSc   = strSc.substring(1,strSc.length-1);
//  strSys  = strSys.substring(1,strSys.length-1);
//  strComp = strComp.substring(1,strComp.length-1);
//  strSitq = strSitq.substring(1,strSitq.length-1);

  dataKey = strKey.split("|");
  for(idx=0;idx<dataKey.length;idx++) {
    var   orKey = new Array;
    orKey = dataKey[idx].split(",");
    andKey[idx] = orKey;
  }
  dataSct = strSct.split("|");
  for(idx=0;idx<dataSct.length;idx++) {
    var   orSct = new Array;
    orSct = dataSct[idx].split(",");
    andSct[idx] = orSct;
  }
  dataSc = strSc.split("|");
  for(idx=0;idx<dataSc.length;idx++) {
    var   orSc = new Array;
    orSc = dataSc[idx].split(",");
    andSc[idx] = orSc;
  }
  dataSys = strSys.split("|");
  for(idx=0;idx<dataSys.length;idx++) {
    var   orSys = new Array;
    orSys = dataSys[idx].split(",");
    andSys[idx] = orSys;
  }
  dataComp = strComp.split("|");
  for(idx=0;idx<dataComp.length;idx++) {
    var   orComp = new Array;
    orComp = dataComp[idx].split(",");
    andComp[idx] = orComp;
  }
  dataSitq = strSitq.split("|");
  for(idx=0;idx<dataSitq.length;idx++) {
    var   orSitq = new Array;
    orSitq = dataSitq[idx].split(",");
    andSitq[idx] = orSitq;
  }
  count = dataSct.length;
  count = Math.max(count,dataSc.length);
  count = Math.max(count,dataSys.length);
  count = Math.max(count,dataComp.length);
  count = Math.max(count,dataSitq.length);
  count = Math.max(count,dataKey.length);
  for(idx=0;idx<count;idx++) {
    var  cdData  = new Array;
    cdData.Key = null;
    cdData.Sct = null;
    cdData.Sc  = null;
    cdData.Sys = null;
    cdData.Comp = null;
    cdData.Sitq = null;
    if(idx < dataKey.length) {
      if(andKey[idx].length > 0) {
        cdData.Key = andKey[idx];
      }
    }
    if(idx < dataSct.length) {
      if(andSct[idx].length > 0) {
        cdData.Sct = andSct[idx];
      }
    }
    if(idx < dataSc.length) {
      if(andSc[idx].length > 0) {
        cdData.Sc = andSc[idx];
      }
    }
    if(idx < dataSys.length) {
      if(andSys[idx].length > 0) {
        cdData.Sys = andSys[idx];
      }
    }
    if(idx < dataComp.length) {
      if(andComp[idx].length > 0) {
        cdData.Comp = andComp[idx];
      }
    }
    if(idx < dataSitq.length) {
      if(andSitq[idx].length > 0) {
        cdData.Sitq = andSitq[idx];
      }
    }
    cdInfo[idx] = cdData;
  }
}
function compareString(cmpData,strKey)
{
   var   keyBuf = new Array;
   var   i,j;
   var   idx = 0;
   var   sava_idx;

   keyBuf = strKey.split("*");
   if(keyBuf.length == 0)
   {
      return true;
   }
   for(i=0;i<keyBuf.length;)
   {
      if(keyBuf[i].length == 0)
      {
         i++;
      }
      else
      {
         while(idx<cmpData.length)
         {
            if((cmpData.charAt(idx) == keyBuf[i].charAt(0)) ||
               (keyBuf[i].charAt(0) == '?'))
            {
               idx++;
               save_idx = idx;
               if(idx < cmpData.length)
               {
                  for(j=1;j<keyBuf[i].length;j++)
                  {
                     if((cmpData.charAt(idx) != keyBuf[i].charAt(j)) &&
                        (keyBuf[i].charAt(j) != '?'))
                     {
                        idx = save_idx;
                        break;
                     }
                     idx++;
                  }
                  if(j == keyBuf[i].length)
                  {
                     i++;
                     break;
                  }
               }
            }
            else
            {
               idx++;
            }
         }
         if(idx >= cmpData.length)
         {
            break;
         }
      }
   }
   if(i < keyBuf.length)
   {
      return false;
   }
   else
   {
      return true;
   }
}
function SetDisplayFlag(strKeywords)
{
  var  i,j,k,ii;
  var  lowTitle,lowSubTitle,lowDgc,strDgc;
  var  strReplace;
  var  keyBuf = new Array;
  var  cnt;

  strReplace = "";
  strKeywords = strKeywords.toLowerCase();
  strReplace = strKeywords.replace(/　/g," ");
  keyBuf = strReplace.split(" ");

  cnt = 0;
  for (i=0; i < tDT.length; ++i) {
    for(j=0;j<cdInfo.length;j++) {
      for(k=0;k<tDT[i].sieKey.length;k++) {
        tDT[i].Display = true;
        lowTitle = tDT[i].Title.toLowerCase();
        if(lowTitle == "na") {
             tDT[i].Display = false;
        }
        else {
          lowSubTitle = tDT[i].SubTitle.toLowerCase();
          strDgc = tDT[i].DgcList[k];
          lowDgc = tDT[i].DgcList[k].toLowerCase();
          if(IsMatchedSct(cdInfo[j].Sct,tDT[i].sieKey[k].Sct) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedSc(cdInfo[j].Sc,tDT[i].sieKey[k].Sc) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedSys(cdInfo[j].Sys,tDT[i].sieKey[k].Sys) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedComp(cdInfo[j].Comp,tDT[i].sieKey[k].Comp) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedSitq(cdInfo[j].Sitq,tDT[i].sieKey[k].Sitq) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedKey(cdInfo[j].Key,tDT[i].sieKey[k].Supp) == false) {
             tDT[i].Display = false;
          }
          if(tDT[i].Display == true) {
             if(keyBuf.length > 0) {
                var   convStr = lowTitle+"("+lowDgc+")"+lowSubTitle
                for(ii=0;ii<keyBuf.length;ii++) {
/*
                  if(lowTitle.indexOf(keyBuf[ii]) < 0) {
                     if(lowSubTitle.indexOf(keyBuf[ii]) < 0) {
                        if(lowDgc.indexOf(keyBuf[ii]) < 0) {
                           tDT[i].Display = false;
                        }
                     }
                  }
*/
                  if((keyBuf[ii].indexOf("*") < 0) &&
                     (keyBuf[ii].indexOf("?") < 0))
                  {
                     if(convStr.indexOf(keyBuf[ii]) < 0) {
                        tDT[i].Display = false;
                     }
                  }
                  else
                  {
                     if(compareString(convStr,keyBuf[ii]) == false)
                     {
                        tDT[i].Display = false;
                     }
                  }
                }
                break;
             }
           }
        }
      }
      if(tDT[i].Display == true) {
        cnt++;
        tDT[i].Dgc = strDgc;
        break;
      }
    }
  }
  return cnt;
}
function SetDTCDisplayFlag(strKeywords)
{
  var  i,j,k;
  var  ii;
  var  lowTitle,lowSubTitle,lowDgc,strDgc;
  var  strReplace;
  var  keyBuf = new Array;
  var  cnt;

  strReplace = "";
  strKeywords = strKeywords.toLowerCase();
  strReplace = strKeywords.replace(/　/g," ");
  keyBuf = strReplace.split(" ");

  cnt = 0;
  for (i=0; i < tDT.length; ++i) {
    for(j=0;j<cdInfo.length;j++) {
      for(k=0;k<tDT[i].sieKey.length;k++) {
        tDT[i].Display = true;
        lowTitle = tDT[i].Title.toLowerCase();
        if(lowTitle == "na") {
             tDT[i].Display = false;
        }
        else {
          lowSubTitle = tDT[i].SubTitle.toLowerCase();
          strDgc = tDT[i].DgcList[k];
          lowDgc = tDT[i].DgcList[k].toLowerCase();
          if(IsMatchedSct(cdInfo[j].Sct,tDT[i].sieKey[k].Sct) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedSc(cdInfo[j].Sc,tDT[i].sieKey[k].Sc) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedSys(cdInfo[j].Sys,tDT[i].sieKey[k].Sys) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedComp(cdInfo[j].Comp,tDT[i].sieKey[k].Comp) == false) {
             tDT[i].Display = false;
          }
          else if(IsMatchedSitq(cdInfo[j].Sitq,tDT[i].sieKey[k].Sitq) == false) {
             tDT[i].Display = false;
          }
          else {
             for(ii=0;ii<tDT[i].Dtc.length;ii++)
             {
                if(IsMatchedKey(cdInfo[j].Key,tDT[i].Dtc[ii]) == true) {
                    break;
                }
             }
             if(ii == tDT[i].Dtc.length) {
                tDT[i].Display = false;
             }
          }
          if(tDT[i].Display == true) {
             if(keyBuf.length > 0) {
                var   convStr = lowTitle+"("+lowDgc+")"+lowSubTitle
                for(ii=0;ii<keyBuf.length;ii++) {
/*
                  if(lowTitle.indexOf(keyBuf[ii]) < 0) {
                     if(lowSubTitle.indexOf(keyBuf[ii]) < 0) {
                        if(lowDgc.indexOf(keyBuf[ii]) < 0) {
                           tDT[i].Display = false;
                        }
                     }
                  }
*/
                  if((keyBuf[ii].indexOf("*") < 0) &&
                     (keyBuf[ii].indexOf("?") < 0))
                  {
                     if(convStr.indexOf(keyBuf[ii]) < 0) {
                        tDT[i].Display = false;
                     }
                  }
                  else
                  {
                     if(compareString(convStr,keyBuf[ii]) == false)
                     {
                        tDT[i].Display = false;
                     }
                  }
                }
                break;
             }
           }
        }
      }
      if(tDT[i].Display == true) {
        cnt++;
        tDT[i].Dgc = strDgc;
        break;
      }
    }
  }
  return cnt;
}


function IsMatchedSct(cmpSct,datSct)
{
  var  ii;
  var  bRtn = true;

  if(cmpSct != null) {
    for(ii=0;ii<cmpSct.length;ii++) {
      if(cmpSct[ii] != "") {
        if(cmpSct[ii].charAt(0) == '!') {
          if(cmpSct[ii].substring(1,cmpSct[ii].length) == datSct) {
            return(false);
          }
          else {
            return(true);
          }
        }
        else {
          if(cmpSct[ii] == datSct) {
            return(true);
          }
        }
        if(cmpSct[ii].charAt(0) == '!') {
          bRtn = true;
        }
        else {
          bRtn = false;
        }
      }
    }
  }

  return(bRtn);
}


function IsMatchedSc(cmpSc,datSc)
{
  var  ii;
  var  bRtn = true;

  if(cmpSc != null) {
    for(ii=0;ii<cmpSc.length;ii++) {
      if(cmpSc[ii] != "") {
        if(cmpSc[ii].charAt(0) == '!') {
          if(cmpSc[ii].substring(1,cmpSc[ii].length) == datSc) {
            return(false);
          }
          else {
            return(true);
          }
        }
        else {
          if(cmpSc[ii] == datSc) {
            return(true);
          }
        }
        if(cmpSc[ii].charAt(0) == '!') {
          bRtn = true;
        }
        else {
          bRtn = false;
        }
      }
    }
  }

  return(bRtn);
}


function IsMatchedSys(cmpSys,datSys)
{
  var  ii;
  var  bRtn = true;

  if(cmpSys != null) {
    for(ii=0;ii<cmpSys.length;ii++) {
      if(cmpSys[ii] != "") {
        if(cmpSys[ii].charAt(0) == '!') {
          if(cmpSys[ii].substring(1,cmpSys[ii].length) == datSys) {
            return(false);
          }
          else {
            return(true);
          }
        }
        else {
          if(cmpSys[ii] == datSys) {
            return(true);
          }
        }
        if(cmpSys[ii].charAt(0) == '!') {
          bRtn = true;
        }
        else {
          bRtn = false;
        }
      }
    }
  }

  return(bRtn);
}


function IsMatchedComp(cmpComp,datComp)
{
  var  ii;
  var  bRtn = true;

  if(cmpComp != null) {
    for(ii=0;ii<cmpComp.length;ii++) {
      if(cmpComp[ii] != "") {
        if(cmpComp[ii].charAt(0) == '!') {
          if(cmpComp[ii].substring(1,cmpComp[ii].length) == datComp) {
            return(false);
          }
          else {
            return(true);
          }
        }
        else {
          if(cmpComp[ii] == datComp) {
            return(true);
          }
        }
        if(cmpComp[ii].charAt(0) == '!') {
          bRtn = true;
        }
        else {
          bRtn = false;
        }
      }
    }
  }

  return(bRtn);
}


function IsMatchedSitq(cmpSitq,datSitq)
{
  var  ii,jj;
  var  bRtn = true;
  var  strVal;

  if(cmpSitq != null) {
    for(ii=0;ii<cmpSitq.length;ii++) {
      if(cmpSitq[ii] != "") {
        if(cmpSitq[ii].charAt(0) == '!') {
          strVal = cmpSitq[ii].substring(1,cmpSitq[ii].length);
        }
        else {
          strVal = cmpSitq[ii];
        }
        for(jj=0;jj<strVal.length;jj++) {
          if(strVal.charAt(jj) != '?') {
            if(strVal.charAt(jj) != datSitq.charAt(jj)) {
              break;
            }
          }
        }
        if(jj == strVal.length) {
          if(cmpSitq[ii].charAt(0) == '!') {
            return(false);
          }
          else {
            return(true);
          }
        }
        if(cmpSitq[ii].charAt(0) == '!') {
          bRtn = true;
        }
        else {
          bRtn = false;
        }
      }
    }
  }

    return(bRtn);
}


function IsMatchedKey(cmpKey,datKey)
{
  var  ii;
  var  bRtn = true;

  if(cmpKey != null) {
    for(ii=0;ii<cmpKey.length;ii++) {
      if(cmpKey[ii] != "") {
        if(cmpKey[ii].charAt(0) == '!') {
          if(cmpKey[ii].substring(1,cmpKey[ii].length) == datKey) {
            return(false);
          }
          else {
            return(true);
          }
        }
        else {
          if(cmpKey[ii] == datKey) {
            return(true);
          }
        }
        bRtn = false;
      }
    }
  }

  return(bRtn);
}
