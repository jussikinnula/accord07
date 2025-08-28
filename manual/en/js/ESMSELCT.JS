/************************************************************************
 * NAME         : FDL
 * FUNCTION     : フォルダ情報項目格納
 * DATE(ORG)    : 2003.06.16(2003.03.10)
 ************************************************************************/
function FDL(code,model,type)                                         /*@B0.c-*/
{                                                                     /*@AV.a-*/
  this.Code =code;                                                    /*@AV.a-*/
  this.Model=model;                                                   /*@AV.a-*/
  this.Type =type;                                                    /*@B0.a-*/
}                                                                     /*@AV.a-*/
/************************************************************************
 * NAME         : FS1
 * FUNCTION     : SIEタイトル情報項目格納
 * PROCESS      : SIEタイトル情報の 1項目データを作成し返します。
 * INPUT        : imgID             | タイトル種別イラスト番号
 * INPUT        : dbKey             | SIE文章dBKey
 * INPUT        : title             | SIEタイトル
 * RETURN       : Array             | SIEタイトル情報
 * DATE(ORG)    : 2002.10.16(2002.05.31)
 * REMARKS      :
 *: @01 2002.10.16  略語参照ボタンをMaRISで使用するイラストに変更する。
 ************************************************************************/
function  FS1(imgID,dbKey,title)
{
  var result  = new Array;

  result.Img  =imgID;
  result.dbKey=dbKey;
  result.Title=title;

  return(result);
}
/************************************************************************
 * NAME         : FS2
 * FUNCTION     : モデルイヤー選択タイトル情報項目格納
 * PROCESS      : モデルイヤー情報の 1項目データを作成し返します。
 * INPUT        : code              | モデルイヤー・コード
 * INPUT        : year              | モデルイヤー
 * RETURN       : Array             | モデルイヤー選択タイトル情報
 * DATE(ORG)    : (2002.05.31)
 * REMARKS      :
 ************************************************************************/
function FS2(code, year)
{
  var data  = new Array;
  data.Code = code;
  data.Year = year;
  return(data);
}
/************************************************************************
 * NAME         : FS3
 * FUNCTION     : SIE選択タイトル情報項目格納
 * PROCESS      : SIE選択タイトル情報の 1項目分を格納し返す。
 * INPUT        : level             | ツリー上の階層レベル番号
 * INPUT        : strFile           | 選択タイトル定義ファイル名
 * INPUT        : strTitle          | 表示タイトル
 * RETURN       : Array             | SIE選択タイトル項目情報
 * DATE(ORG)    : (2002.05.31)
 * REMARKS      :
 ************************************************************************/
function FS3(level, strFile, strTitle)
{
  var data    = new Array;
  data.Level  = level;
  data.File   = strFile;
  data.Title  = strTitle;
  return(data);
}
/************************************************************************
 * NAME         : FS5
 * FUNCTION     : メッセージ情報項目格納
 * PROCESS      : メッセージ情報の 1項目分を格納し返す。
 * INPUT        : id                | メッセージID
 * INPUT        : text              | メッセージ・テキスト
 * RETURN       : Array             | メッセージ項目情報
 * DATE(ORG)    : (2002.05.31)
 * REMARKS      :
 ************************************************************************/
function FS5(id,text)
{
  var data  = new Array;
  data.id   = id;
  data.Text = text;
  return(data);
}
/************************************************************************
 * NAME         : FS6
 * FUNCTION     : 主題情報項目格納
 * PROCESS      : 主題情報の 1項目分を格納し返す。
 * INPUT        : code              | サブジェクト・コード
 * INPUT        : name              | サブジェクト名
 * INPUT        : title             | 項目選択タイトル
 * RETURN       : Array             | 主題項目情報
 * DATE(ORG)    : (2002.06.05)
 * REMARKS      :
 ************************************************************************/
function FS6(code,name,title)
{
  var data    = new Array;
  data.Code   = code;
  data.Name   = name;
  data.Title  = title;
  return(data);
}
/************************************************************************
 * NAME         : FI1
 * FUNCTION     : SIEリスト一覧表示
 * PROCESS      : System/Componentで選択された項目に対応するSIEリストをの
 *              : 表示要求を行う。
 * UPDATE       : doc               | 表示先ドキュメントオブジェクト
 * INPUT        : strIndex          | 表示SIEリスト インデックス名
 * RETURN       : なし
 * DATE(ORG)    : (2002.06.05)
 * REMARKS      :
 ************************************************************************/
function FI1(doc,strIndex)
{
  doc.ESM = gESM;
  doc.ESM.ndxSel = strIndex;
  doc.location.href = "&EsmCtlPath;ESMINDEX.HTML";
}
/************************************************************************
 * NAME         : FI2
 * FUNCTION     : SIEリスト一覧描画
 * PROCESS      : System/Componentで選択された項目に対応するSIEリストを
 *              : 表示する。
 * INPUT        : なし
 * RETURN       : なし
 * DATE(ORG)    : 2003.06.16(2002.06.05)
 * REMARKS      :
 *: @01 2002.10.16  略語参照ボタンをMaRISで使用するイラストに変更する。
 *: @B2 2003.06.16  生成エラー時、実行でもエラーと成る不具合を修正。
 ************************************************************************/
function FI2()
{
  var i;
  var data,sie;

  gESM = parent.document.ESM;
  if ((gESM.SIE.length <= 0) || (typeof(FIN) != "function")) {      /*@02.c-*/
    return;
  }

  data = FIN();
  with (document) {
    write("<div class=\"title\">&EsmResult;</div>");
    if (gESM.Abbrev != "") {
      write("<div align=\"right\" class=\"abbrev\">");
      write("<img src=\"&EsmImgPath;CTL/ABBREVIATION.PNG\" " +      /*@01.c-*/
            "title=\"&EsmSelAbbreviat;\" " +                        /*@01.a-*/
            "onclick=\"OnAbbrev();\" ondblclick=\"OnAbbrev();\"></div>");
    }
    write("<table style=\"margin-left:1em;\"><tr>");
    for (i=0; i < data.length; ++i) {
      sie = FSS(data[i]);
      if (sie == null) {
        alert("dbKey(" + data[i] + ") undefined.");
        continue;
      }
      write("<td valign=\"top\">" +
            "<img src=\"&EsmImgPath;CTL/" + sie.Img + ".PNG\"></td><td>");
      write("<a href=\"../" + sie.dbKey.substr(5,2) + "/" + sie.dbKey + ".HTML\" " +
            "target=\"EsmContents\">");
      write(sie.Title + "</a></td></tr>");
    }
    write("</tr></table></div>");
  }
}
/************************************************************************
 * NAME         : FSS
 * FUNCTION     : SIEタイトル取得
 * PROCESS      : DBKEYに対応するSIEタイトルを検索し返す。
 *              : 検索には、2分検索を使用する。
 * INPUT        : dbKey             | SIE DBキー
 * RETURN       : String            | SIEタイトル
 * INPUT(EXT)   : gESM.SIE          | SIEタイトル情報
 * DATE(ORG)    : 2003.06.14(2002.05.31)
 * CALL         : Array::Length
 * CALL         : Math::floor
 * REMARKS      :
 *: @02 2003.06.14  未定義時ループする不具合対応の為、Cのbsearch関数を使用。
 ************************************************************************/
function FSS(dbKey)
{
  var nTop, nLast;
  var nMid, nHalf, nNum;
  var i = 0;

  with (gESM) {
    nNum = SIE.length;
    nTop = 0;
    nLast = nNum - 1;
    while (nTop <= nLast) {
      if ((nHalf = Math.floor(nNum / 2)) != 0) {
        nMid = nTop + ((nNum & 1)? nHalf:(nHalf - 1));
        if (SIE[nMid].dbKey == dbKey) {
          return(SIE[nMid]);
        }
        if (SIE[nMid].dbKey > dbKey) {
          nLast = nMid - 1;
          nNum  = (nNum & 1)? nHalf:(nHalf - 1);
        }
        else {
          nTop = nMid + 1;
          nNum = nHalf;
        }
      }
      else {
        if (nNum != 0) {
          if (SIE[nTop].dbKey == dbKey) {
            return(SIE[nTop]);
          }
        }
        break;
      }
    }
  }

  return(null);
}
/************************************************************************
 * NAME         : OnAbbrev
 * FUNCTION     : 略語表示
 * PROCESS      : 略語説明文章を別ウィンドウで表示する。
 * INPUT        : なし
 * RETURN       : なし
 * UPDATE(EXT)  : gESM.Abbrev       | 略語文章パス名
 * DATE(ORG)    : (2002.05.31)
 * CALL         : String::substr
 * CALL         : window::open
 * REMARKS      :
 ************************************************************************/
function OnAbbrev()
{
  window.open("../" + gESM.Abbrev.substr(5,2) + "/"+ gESM.Abbrev + ".HTML",
              "abbWindow",
              "status=yes toolbar=no menubar=yes resizable=yes scrollbars=yes");
}
