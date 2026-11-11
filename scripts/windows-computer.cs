using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
public class ComputerInput {
  [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
  [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)]public MOUSE mouse;[FieldOffset(0)]public KEY key;}
  [StructLayout(LayoutKind.Sequential)] struct MOUSE {public int x,y;public uint mouseData,flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
  [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
  static void Send(INPUT input){if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("Windows did not accept input; elevated or secure windows cannot be controlled.");}
  static void Mouse(uint flags,uint value=0){Send(new INPUT{type=0,data=new UNION{mouse=new MOUSE{flags=flags,mouseData=value}}});}
  static void Key(ushort code,bool up=false){Send(new INPUT{type=1,data=new UNION{key=new KEY{vk=code,flags=up?2u:0u}}});}
  static Dictionary<string,ushort> keys=new Dictionary<string,ushort>(StringComparer.OrdinalIgnoreCase){{"ctrl",17},{"control",17},{"alt",18},{"shift",16},{"win",91},{"meta",91},{"enter",13},{"return",13},{"tab",9},{"escape",27},{"esc",27},{"backspace",8},{"delete",46},{"space",32},{"up",38},{"down",40},{"left",37},{"right",39},{"home",36},{"end",35},{"pageup",33},{"pagedown",34}};
  static ushort Code(string name){ushort key;if(keys.TryGetValue(name,out key))return key;if(name.Length==1&&char.IsLetterOrDigit(name[0]))return (ushort)char.ToUpperInvariant(name[0]);int f;if(name.StartsWith("f",StringComparison.OrdinalIgnoreCase)&&int.TryParse(name.Substring(1),out f)&&f>=1&&f<=24)return (ushort)(111+f);throw new Exception("Unsupported key: "+name);}
  public static int Main(){try{Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);SetProcessDPIAware();var p=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(Console.In.ReadToEnd());string action=(string)p["action"];
    if(action=="click"||action=="move"||action=="drag"){int x=Convert.ToInt32(p["x"]),y=Convert.ToInt32(p["y"]);if(!SetCursorPos(x,y))throw new Exception("Cursor could not move.");if(action=="click"){string button=p.ContainsKey("button")?(string)p["button"]:"left";uint down=button=="right"?8u:button=="middle"?32u:2u,up=down*2;int count=p.ContainsKey("count")?Convert.ToInt32(p["count"]):1;for(int i=0;i<count;i++){Mouse(down);try{}finally{Mouse(up);}if(i+1<count)System.Threading.Thread.Sleep(80);}}else if(action=="drag"){int tx=Convert.ToInt32(p["toX"]),ty=Convert.ToInt32(p["toY"]);Mouse(2);try{for(int step=1;step<=20;step++){if(!SetCursorPos(x+(tx-x)*step/20,y+(ty-y)*step/20))throw new Exception("Drag interrupted.");System.Threading.Thread.Sleep(12);}}finally{Mouse(4);}}}
    else if(action=="type"){foreach(char ch in (string)p["text"]){var item=new INPUT{type=1,data=new UNION{key=new KEY{scan=ch,flags=4}}};Send(item);item.data.key.flags=6;Send(item);}}
    else if(action=="key"){var codes=new List<ushort>();foreach(string key in ((string)p["keys"]).Split('+'))codes.Add(Code(key.Trim()));int pressed=0;try{foreach(ushort code in codes){Key(code);pressed++;}}finally{for(int i=pressed-1;i>=0;i--)Key(codes[i],true);}}
    else if(action=="scroll")Mouse(0x800,unchecked((uint)(Convert.ToInt32(p["amount"])*120)));
    else if(action=="reset"){Mouse(4);Mouse(16);Mouse(64);for(ushort code=1;code<256;code++)Key(code,true);}
    else throw new Exception("Unsupported action.");Console.Write("{\"ok\":true}");return 0;
  }catch(Exception error){Console.Error.Write(error.Message);return 1;}}
}
