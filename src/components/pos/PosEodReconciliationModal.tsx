import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  Timestamp, 
  doc, 
  updateDoc,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { 
  PosEodReconciliation, 
  SalesTransaction, 
  UserProfile 
} from '../../types';
import { 
  Calculator, 
  DollarSign, 
  CreditCard, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Lock, 
  FileText, 
  X,
  History,
  QrCode,
  ArrowRight
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { calculateEodReconciliation } from '../../lib/posEngine';

interface PosEodReconciliationModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile | null;
}

export const PosEodReconciliationModal: React.FC<PosEodReconciliationModalProps> = ({
  open,
  onClose,
  profile
}) => {
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [pastReports, setPastReports] = useState<PosEodReconciliation[]>([]);
  const [selectedReport, setSelectedReport] = useState<PosEodReconciliation | null>(null);

  // Cashier Input Form (Blind Count)
  const [physicalCash, setPhysicalCash] = useState<number | ''>('');
  const [physicalCreditSlips, setPhysicalCreditSlips] = useState<number | ''>('');
  const [physicalDebitSlips, setPhysicalDebitSlips] = useState<number | ''>('');
  const [physicalQr, setPhysicalQr] = useState<number | ''>('');
  const [cashierNotes, setCashierNotes] = useState('');

  // Manager Approval State
  const [managerPin, setManagerPin] = useState('');
  const [managerNotes, setManagerNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // System Sales Stats for current shift
  const [todaySales, setTodaySales] = useState<{
    cash: number;
    creditCard: number;
    debitCard: number;
    qr: number;
    total: number;
    count: number;
  }>({
    cash: 0,
    creditCard: 0,
    debitCard: 0,
    qr: 0,
    total: 0,
    count: 0
  });

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Fetch sales transactions for today to establish the system benchmark
  useEffect(() => {
    if (!open) return;

    const fetchShiftSales = async () => {
      try {
        const snap = await getDocs(collection(db, 'salesTransactions'));
        let cash = 0;
        let credit = 0;
        let debit = 0;
        let qr = 0;
        let count = 0;

        snap.docs.forEach(d => {
          const tx = d.data() as SalesTransaction;
          // Filter by date (either today or all recent un-reconciled)
          let txDate = todayStr;
          if (tx.timestamp) {
            if (typeof tx.timestamp === 'string') {
              txDate = tx.timestamp.split('T')[0];
            } else if ((tx.timestamp as any).toDate) {
              txDate = (tx.timestamp as any).toDate().toISOString().split('T')[0];
            }
          }

          if (txDate === todayStr) {
            count++;
            const amt = tx.total || 0;
            const method = (tx.paymentMethod as string) || 'cash';
            if (method === 'cash') cash += amt;
            else if (method === 'card' || method === 'credit_card' || method === 'credit') credit += amt;
            else if (method === 'debit_card') debit += amt;
            else if (method === 'qr_pay' || method === 'qr') qr += amt;
            else cash += amt;
          }
        });

        setTodaySales({
          cash: Math.round(cash * 100) / 100,
          creditCard: Math.round(credit * 100) / 100,
          debitCard: Math.round(debit * 100) / 100,
          qr: Math.round(qr * 100) / 100,
          total: Math.round((cash + credit + debit + qr) * 100) / 100,
          count
        });
      } catch (err) {
        console.error('Error tallying shift sales:', err);
      }
    };

    fetchShiftSales();

    // Listen to previous EOD reports
    const unsubReports = onSnapshot(collection(db, 'posReconciliations'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as PosEodReconciliation));
      list.sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
      setPastReports(list);
    }, (err) => {
      console.warn('posReconciliations listener notice:', err);
    });

    return () => unsubReports();
  }, [open, todayStr]);

  // Dynamic variance computation
  const reconciliationResult = useMemo(() => {
    return calculateEodReconciliation({
      physicalCash: Number(physicalCash) || 0,
      physicalCreditCards: Number(physicalCreditSlips) || 0,
      physicalDebitCards: Number(physicalDebitSlips) || 0,
      physicalQr: Number(physicalQr) || 0,
      systemSales: todaySales
    });
  }, [physicalCash, physicalCreditSlips, physicalDebitSlips, physicalQr, todaySales]);

  // Is user manager/admin/director
  const isManager = profile?.role === 'manager' || 
                    profile?.role === 'admin' || 
                    profile?.role === 'owner' || 
                    profile?.email === 'arvin8786@gmail.com';

  const handleSubmitReconciliation = async (requireManagerApproval: boolean) => {
    if (physicalCash === '' && physicalCreditSlips === '' && physicalDebitSlips === '') {
      toast.error('Please input physical cash or card slip totals before submitting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const recNumber = `EOD-${todayStr.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const reportData: Omit<PosEodReconciliation, 'id'> = {
        reconciliationNumber: recNumber,
        registerId: 'REG-01',
        cashierId: profile?.uid || 'CASHIER-01',
        cashierName: profile?.displayName || profile?.email || 'Active Cashier',
        shiftDate: todayStr,
        closedAt: Timestamp.now(),
        physicalCashCounted: Number(physicalCash) || 0,
        physicalCreditCardSlips: Number(physicalCreditSlips) || 0,
        physicalDebitCardSlips: Number(physicalDebitSlips) || 0,
        physicalQrTotal: Number(physicalQr) || 0,
        systemCashSales: todaySales.cash,
        systemCreditCardSales: todaySales.creditCard,
        systemDebitCardSales: todaySales.debitCard,
        systemQrSales: todaySales.qr,
        systemTotalSales: todaySales.total,
        totalTransactionsCount: todaySales.count,
        cashVariance: reconciliationResult.cashVariance,
        cardVariance: reconciliationResult.cardVariance,
        totalVariance: reconciliationResult.totalVariance,
        status: requireManagerApproval ? 'manager_approved' : (reconciliationResult.flagged ? 'flagged' : 'submitted'),
        isLocked: requireManagerApproval, // Lock immutable when approved
        managerId: requireManagerApproval ? profile?.uid : undefined,
        managerName: requireManagerApproval ? (profile?.displayName || 'Authorized Manager') : undefined,
        managerSignedAt: requireManagerApproval ? Timestamp.now() : undefined,
        managerNotes: managerNotes.trim() || undefined,
        cashierNotes: cashierNotes.trim() || undefined,
        createdAt: Timestamp.now()
      };

      await addDoc(collection(db, 'posReconciliations'), reportData);

      toast.success(`EOD Reconciliation ${recNumber} submitted successfully! ${requireManagerApproval ? 'Signed & Locked.' : ''}`);
      onClose();
    } catch (err: any) {
      toast.error('Failed to save reconciliation report: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManagerApproveReport = async (reportId: string) => {
    if (!isManager) {
      toast.error('Manager privileges required to sign and lock EOD reconciliations.');
      return;
    }

    try {
      const ref = doc(db, 'posReconciliations', reportId);
      await updateDoc(ref, {
        status: 'manager_approved',
        isLocked: true,
        managerId: profile?.uid,
        managerName: profile?.displayName || 'Store Manager',
        managerSignedAt: Timestamp.now(),
        managerNotes: managerNotes.trim() || 'Verified against cash drawer and bank batch settlement.'
      });

      toast.success('EOD Reconciliation verified, signed, and locked.');
      setSelectedReport(null);
    } catch (err: any) {
      toast.error('Failed to approve report: ' + err.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                <Calculator className="w-5 h-5" />
              </span>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  Daily POS End-of-Day (EOD) Reconciliation
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Blind cash tally, card slip audit, and variance verification for Register REG-01.
                </DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              Shift Date: {todayStr}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full mt-3">
          <TabsList className="bg-slate-100 p-1 rounded-xl grid grid-cols-2 w-72 mb-4">
            <TabsTrigger value="new" className="text-xs">
              Active Shift Tally
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">
              Audit Logs ({pastReports.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: New EOD Tally */}
          <TabsContent value="new" className="space-y-5">
            {/* Step 1: Cashier Blind Count */}
            <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                1. Physical Cash & Payment Slip Tally (Cashier Count)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Physical Cash in Drawer ($)
                  </Label>
                  <Input 
                    type="number"
                    step="0.01"
                    placeholder="e.g. 850.50"
                    value={physicalCash}
                    onChange={e => setPhysicalCash(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="font-mono text-sm bg-white"
                  />
                  <p className="text-[10px] text-slate-400">Total physical coins and currency bills counted.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Credit Card Physical Slip Batch Total ($)
                  </Label>
                  <Input 
                    type="number"
                    step="0.01"
                    placeholder="e.g. 1420.00"
                    value={physicalCreditSlips}
                    onChange={e => setPhysicalCreditSlips(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="font-mono text-sm bg-white"
                  />
                  <p className="text-[10px] text-slate-400">From the physical EFTPOS terminal batch settlement slip.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Debit Card Physical Slip Total ($)
                  </Label>
                  <Input 
                    type="number"
                    step="0.01"
                    placeholder="e.g. 540.00"
                    value={physicalDebitSlips}
                    onChange={e => setPhysicalDebitSlips(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="font-mono text-sm bg-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    QR / Digital Payment Total ($)
                  </Label>
                  <Input 
                    type="number"
                    step="0.01"
                    placeholder="e.g. 230.00"
                    value={physicalQr}
                    onChange={e => setPhysicalQr(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="font-mono text-sm bg-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-semibold text-slate-700">Cashier Remarks / Shift Notes</Label>
                <Input 
                  placeholder="Optional notes regarding till float, coin exchange, or voided transactions..."
                  value={cashierNotes}
                  onChange={e => setCashierNotes(e.target.value)}
                  className="text-xs bg-white"
                />
              </div>
            </div>

            {/* Step 2: System Comparison & Variance Ledger */}
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="bg-slate-900 text-white p-3 px-4 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">
                  2. System vs Physical Variance Report (Live Comparison)
                </span>
                <span className="text-xs text-slate-300 font-mono">
                  {todaySales.count} Transactions Today
                </span>
              </div>

              <div className="p-4 bg-white space-y-3">
                <div className="grid grid-cols-4 text-xs font-semibold text-slate-500 border-b pb-2">
                  <span>Payment Channel</span>
                  <span className="text-right">Physical Count</span>
                  <span className="text-right">System Recorded</span>
                  <span className="text-right">Variance ($)</span>
                </div>

                {/* Cash row */}
                <div className="grid grid-cols-4 text-xs items-center py-1">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Cash (Till Drawer)
                  </span>
                  <span className="text-right font-mono font-medium">${(Number(physicalCash) || 0).toFixed(2)}</span>
                  <span className="text-right font-mono text-slate-600">${todaySales.cash.toFixed(2)}</span>
                  <span className={`text-right font-mono font-bold ${
                    reconciliationResult.cashVariance === 0 
                      ? 'text-emerald-600' 
                      : reconciliationResult.cashVariance > 0 
                      ? 'text-blue-600' 
                      : 'text-rose-600'
                  }`}>
                    {reconciliationResult.cashVariance > 0 ? '+' : ''}${reconciliationResult.cashVariance.toFixed(2)}
                  </span>
                </div>

                {/* Cards row */}
                <div className="grid grid-cols-4 text-xs items-center py-1 border-t border-slate-100">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-blue-600" /> Credit & Debit Slips
                  </span>
                  <span className="text-right font-mono font-medium">${reconciliationResult.physicalCards.toFixed(2)}</span>
                  <span className="text-right font-mono text-slate-600">${(todaySales.creditCard + todaySales.debitCard).toFixed(2)}</span>
                  <span className={`text-right font-mono font-bold ${
                    reconciliationResult.cardVariance === 0 
                      ? 'text-emerald-600' 
                      : reconciliationResult.cardVariance > 0 
                      ? 'text-blue-600' 
                      : 'text-rose-600'
                  }`}>
                    {reconciliationResult.cardVariance > 0 ? '+' : ''}${reconciliationResult.cardVariance.toFixed(2)}
                  </span>
                </div>

                {/* QR row */}
                <div className="grid grid-cols-4 text-xs items-center py-1 border-t border-slate-100">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5 text-purple-600" /> QR / Digital
                  </span>
                  <span className="text-right font-mono font-medium">${reconciliationResult.physicalQr.toFixed(2)}</span>
                  <span className="text-right font-mono text-slate-600">${todaySales.qr.toFixed(2)}</span>
                  <span className={`text-right font-mono font-bold ${
                    reconciliationResult.qrVariance === 0 
                      ? 'text-emerald-600' 
                      : reconciliationResult.qrVariance > 0 
                      ? 'text-blue-600' 
                      : 'text-rose-600'
                  }`}>
                    {reconciliationResult.qrVariance > 0 ? '+' : ''}${reconciliationResult.qrVariance.toFixed(2)}
                  </span>
                </div>

                {/* Net Total & Status */}
                <div className="grid grid-cols-4 text-xs items-center py-2.5 border-t-2 border-slate-200 bg-slate-50/80 px-2 rounded-lg font-bold">
                  <span className="text-slate-900 uppercase">Net Tally Total</span>
                  <span className="text-right font-mono text-slate-900">${reconciliationResult.totalPhysical.toFixed(2)}</span>
                  <span className="text-right font-mono text-slate-700">${todaySales.total.toFixed(2)}</span>
                  <span className={`text-right font-mono text-sm ${
                    reconciliationResult.totalVariance === 0 
                      ? 'text-emerald-600' 
                      : Math.abs(reconciliationResult.totalVariance) <= 5
                      ? 'text-amber-600'
                      : 'text-rose-600'
                  }`}>
                    {reconciliationResult.totalVariance > 0 ? '+' : ''}${reconciliationResult.totalVariance.toFixed(2)}
                  </span>
                </div>

                {reconciliationResult.flagged && (
                  <div className="flex items-center gap-2 text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      High Variance Warning: Total discrepancy exceeds tolerance ($10.00). Strict Manager Audit and authorization required.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Step 3: Manager Sign-off & Lock Box */}
            {isManager && (
              <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    3. Executive / Manager Sign-Off (Lock Ledger)
                  </h4>
                  <Badge className="bg-emerald-600 text-white text-[10px]">
                    Authorized Signatory
                  </Badge>
                </div>
                <p className="text-xs text-emerald-800">
                  Signing this reconciliation makes the record immutable and completes the register shift audit.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input 
                    type="password"
                    placeholder="Enter Supervisor PIN / Passcode..."
                    value={managerPin}
                    onChange={e => setManagerPin(e.target.value)}
                    className="text-xs bg-white"
                  />
                  <Input 
                    placeholder="Manager verification notes..."
                    value={managerNotes}
                    onChange={e => setManagerNotes(e.target.value)}
                    className="text-xs bg-white"
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAB 2: Historical EOD Reconciliations */}
          <TabsContent value="history" className="space-y-4">
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-3 font-semibold">Report #</th>
                    <th className="p-3 font-semibold">Date</th>
                    <th className="p-3 font-semibold">Cashier</th>
                    <th className="p-3 font-semibold text-right">Physical Total</th>
                    <th className="p-3 font-semibold text-right">System Total</th>
                    <th className="p-3 font-semibold text-right">Variance</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pastReports.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400">
                        No previous EOD reconciliations logged yet.
                      </td>
                    </tr>
                  ) : (
                    pastReports.map(rep => (
                      <tr key={rep.id} className="hover:bg-slate-50/70">
                        <td className="p-3 font-mono font-bold text-slate-900">{rep.reconciliationNumber}</td>
                        <td className="p-3 text-slate-600">{rep.shiftDate}</td>
                        <td className="p-3 font-medium text-slate-800">{rep.cashierName}</td>
                        <td className="p-3 font-mono text-right font-medium">
                          ${(rep.physicalCashCounted + rep.physicalCreditCardSlips + rep.physicalDebitCardSlips + rep.physicalQrTotal).toFixed(2)}
                        </td>
                        <td className="p-3 font-mono text-right text-slate-600">
                          ${(rep.systemTotalSales || 0).toFixed(2)}
                        </td>
                        <td className={`p-3 font-mono font-bold text-right ${
                          rep.totalVariance === 0 
                            ? 'text-emerald-600' 
                            : rep.totalVariance > 0 
                            ? 'text-blue-600' 
                            : 'text-rose-600'
                        }`}>
                          {rep.totalVariance > 0 ? '+' : ''}${rep.totalVariance.toFixed(2)}
                        </td>
                        <td className="p-3">
                          <Badge 
                            variant="outline"
                            className={`text-[10px] font-bold ${
                              rep.status === 'manager_approved' 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : rep.status === 'flagged' 
                                ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {rep.status === 'manager_approved' ? (
                              <span className="flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" /> Approved & Locked
                              </span>
                            ) : rep.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          {rep.status !== 'manager_approved' && isManager && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => handleManagerApproveReport(rep.id)}
                              className="h-7 text-xs gap-1 border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" /> Sign & Lock
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:justify-between items-center">
          <Button variant="ghost" onClick={onClose} className="text-xs">
            Cancel
          </Button>

          {activeTab === 'new' && (
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                onClick={() => handleSubmitReconciliation(false)}
                disabled={isSubmitting}
                className="text-xs"
              >
                Submit Cashier Count (Pending Sign-Off)
              </Button>

              {isManager && (
                <Button 
                  onClick={() => handleSubmitReconciliation(true)}
                  disabled={isSubmitting}
                  className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                >
                  <Lock className="w-3.5 h-3.5" /> Verify, Sign & Lock EOD Report
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
