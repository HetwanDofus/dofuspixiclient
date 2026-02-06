onClipEvent(load){
   nbr = 1;
   while(nbr < 2)
   {
      compte = random(300000);
      _parent._parent.attachMovie("minifeux4","minifeux4" + compte,compte);
      eval("_parent._parent.minifeux4" + compte)._x = _X;
      eval("_parent._parent.minifeux4" + compte)._y = _Y + _parent._y;
      nbr++;
   }
   angle = -1.1415 + 0.2 * (-0.5 + Math.random());
   vit = 2 + 10 * Math.random();
   stop();
   frein = 0.9 + 0.05 * Math.random();
   vr = 0;
   sz = 240 + random(120);
   frangle = 1.2;
}
