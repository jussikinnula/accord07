function LangItem(strCode, strName)
{
   var data    = new Array;
   data.Code  = strCode;
   data.Name  = strName;
   return(data);
}
function SetLang()
{
   var i=0;
   gLng[i++] = LangItem('en','English');
}
