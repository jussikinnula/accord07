function CreateModelInf()
{
   var   i,j;
   i = 0;
   gModelInfo[i] = SetModelInf('2003');
   j = 0;
   gModelInfo[i].CodeList[j++] = SetModelCode('CL7');
   gModelInfo[i].CodeList[j++] = SetModelCode('CL9');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM2');
   i++;
   gModelInfo[i] = SetModelInf('2004');
   j = 0;
   gModelInfo[i].CodeList[j++] = SetModelCode('CL7');
   gModelInfo[i].CodeList[j++] = SetModelCode('CL9');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM2');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN2');
   i++;
   gModelInfo[i] = SetModelInf('2005');
   j = 0;
   gModelInfo[i].CodeList[j++] = SetModelCode('CL7');
   gModelInfo[i].CodeList[j++] = SetModelCode('CL9');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM2');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN2');
   i++;
   gModelInfo[i] = SetModelInf('2006');
   j = 0;
   gModelInfo[i].CodeList[j++] = SetModelCode('CL7');
   gModelInfo[i].CodeList[j++] = SetModelCode('CL9');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM2');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN2');
   i++;
   gModelInfo[i] = SetModelInf('2007');
   j = 0;
   gModelInfo[i].CodeList[j++] = SetModelCode('CL7');
   gModelInfo[i].CodeList[j++] = SetModelCode('CL9');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM2');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN2');
   i++;
   gModelInfo[i] = SetModelInf('2008');
   j = 0;
   gModelInfo[i].CodeList[j++] = SetModelCode('CL7');
   gModelInfo[i].CodeList[j++] = SetModelCode('CL9');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CM2');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN1');
   gModelInfo[i].CodeList[j++] = SetModelCode('CN2');
   i++;
}
function SetModelInf(strYear)
{
   var  data = new Array;
   data.Year = strYear;
   data.CodeList = new Array;
   return data;
}
function SetModelCode(strCode)
{
   var  data = new Array;
   data.Code = strCode;
   return data;
}
function SetManualType()
{
   gSmFlag = 1;
   gBrmFlag = 1;
}
