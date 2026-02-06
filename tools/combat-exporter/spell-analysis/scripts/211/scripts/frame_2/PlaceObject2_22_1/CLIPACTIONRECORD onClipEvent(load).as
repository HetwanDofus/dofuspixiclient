onClipEvent(load){
   x1 = _parent.cellFrom.x;
   y1 = _parent.cellFrom.y - 20;
   x2 = _parent.cellTo.x;
   y2 = _parent.cellTo.y - 20;
   _parent.clac._x = x2;
   _parent.clac._y = y2;
   _X = x1;
   _Y = y1;
   dx = x2 - x1;
   dy = y2 - y1;
   d = Math.sqrt(dx * dx + dy * dy);
   _rotation = Math.atan2(dy,dx) * 180 / 3.1415;
}
