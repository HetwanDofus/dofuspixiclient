onClipEvent(load){
   _X = _parent.cellFrom.x;
   _Y = _parent.cellFrom.y - 25;
   _parent.a._x = _parent.cellTo.x;
   _parent.a._y = _parent.cellTo.y - 25;
   dx = - _X + _parent.a._x;
   dy = - _Y + _parent.a._y;
   d = Math.sqrt(dx * dx + dy * dy);
   inte = Math.round(d / 13);
   ix = dx / inte;
   iy = dy / inte;
   c = 0;
   lok = 0;
   t2 = 0;
}
