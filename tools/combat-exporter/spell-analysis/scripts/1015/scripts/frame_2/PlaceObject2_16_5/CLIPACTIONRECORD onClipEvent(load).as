onClipEvent(load){
   var rootMC = _parent;
   var DEG2RAD = 0.017453292519943295;
   var LIM = 50;
   var BASE = 90;
   var VEL = 7.67;
   _X = rootMC.cellFrom.x;
   _Y = rootMC.cellFrom.y - 100;
   angle = BASE;
   vr = (Math.random() - 0.5) * 5;
   limy = _Y + 90 + Math.random() * 20;
   done = false;
   c = 0;
}
